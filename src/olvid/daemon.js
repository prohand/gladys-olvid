// -----------------------------------------------------------------------------
// The Olvid side of the integration.
//
// An Olvid bot is made of two halves: the DAEMON (an Olvid client embedding the
// cryptographic engine, exposing a gRPC API — run by the user next to Gladys)
// and the BOT LOGIC (this integration). This module owns everything that talks
// gRPC, so the rest of the code only sees plain JavaScript:
//
//   - provisioning: pick (or create) the Olvid profile, mint the client key
//     the integration authenticates with — all of it from the admin key the
//     user pasted in the Configuration screen;
//   - messaging: send a text (and an image) to a contact, receive the messages
//     of the one-to-one discussions;
//   - invitations: the "particulier" way of meeting someone on Olvid — an
//     invitation link, then a 4-digit SAS exchange that Olvid never automates
//     (mutual trust is the whole point of the protocol);
//   - the connection lifecycle: the Olvid client stops itself when the daemon
//     goes away, so we watch it and rebuild a fresh one with a backoff.
//
// Note on identifiers: a contact is exposed to Gladys through its cryptographic
// bytes identifier (see identifiers.js), never through the daemon-local row id.
// -----------------------------------------------------------------------------

import { create } from '@bufbuild/protobuf';
import { createLogger } from '@gladysassistant/integration-sdk';
import { OlvidAdminClient, OlvidClient, datatypes } from '@olvid/bot-node';

import { decodeImageAttachment } from './attachments.js';
import { encodeContactKey, shortenContactKey } from './identifiers.js';
import { splitOutgoing } from '../text.js';

const logger = createLogger({ name: 'olvid' });

// Name of the client key the integration creates for itself on the daemon.
const CLIENT_KEY_NAME = 'gladys-assistant';

const HEALTH_CHECK_INTERVAL_MS = 60_000;
const RECONNECT_BASE_DELAY_MS = 5_000;
const RECONNECT_MAX_DELAY_MS = 300_000;
// Attempts kept at the base delay before the exponential backoff starts. The
// first failures of a session are usually not a problem to back off from: the
// daemon Gladys just started is still booting (a JVM, plus the image pull on
// the very first install), and answering "unavailable" while it does.
const RECONNECT_STEADY_ATTEMPTS = 12;

// Invitation statuses where the user has to read a code in Gladys, or type
// theirs in it — the manual step of the Olvid trust establishment.
const SAS_STATUSES = new Set([
  datatypes.Invitation_Status.INVITATION_WAIT_YOU_FOR_SAS_EXCHANGE,
  datatypes.Invitation_Status.INVITATION_WAIT_IT_FOR_SAS_EXCHANGE,
]);

// Invitation statuses we can accept on our own. Group invitations are NOT in
// the list: a bot that joins a group would let a third party speak with the
// authority of the linked user.
const ACCEPTABLE_STATUSES = new Set([
  datatypes.Invitation_Status.INVITATION_WAIT_YOU_TO_ACCEPT,
  datatypes.Invitation_Status.INTRODUCTION_WAIT_YOU_TO_ACCEPT,
  datatypes.Invitation_Status.ONE_TO_ONE_INVITATION_WAIT_YOU_TO_ACCEPT,
]);

export class OlvidDaemon {
  /**
   * @param {object} options - Wiring of the daemon session.
   * @param {Function} options.onIncomingMessage - `({ contactKey, contactName, text, attachmentsCount, receivedAt }) => Promise`.
   * @param {Function} options.onConnectionChange - `(connected, message?) => Promise`, mirrored to the Gladys UI.
   * @param {Function} options.saveClientKey - `(clientKey) => Promise`, persists the minted key in the integration config.
   * @param {Function} [options.createClient] - Builds an identity-scoped client (seam for the tests).
   * @param {Function} [options.createAdminClient] - Builds an admin client (seam for the tests).
   * @example
   * const daemon = new OlvidDaemon({ onIncomingMessage, onConnectionChange, saveClientKey });
   */
  constructor({
    onIncomingMessage,
    onConnectionChange,
    saveClientKey,
    createClient = (options) => new OlvidClient(options),
    createAdminClient = (options) => new OlvidAdminClient(options),
  }) {
    this.onIncomingMessage = onIncomingMessage;
    this.onConnectionChange = onConnectionChange;
    this.saveClientKey = saveClientKey;
    this.createClient = createClient;
    this.createAdminClient = createAdminClient;

    this.config = null;
    this.client = null;
    this.adminClient = null;
    this.identity = null;

    // Contact caches: Gladys contact id <-> daemon-local contact id.
    this.contactIdByKey = new Map();
    this.contactKeyById = new Map();
    this.contactNameById = new Map();
    this.discussionIdByContactId = new Map();

    this.subscriptions = [];
    this.healthTimer = null;
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;
    this.reconnecting = false;
    this.stopping = false;
  }

  /**
   * @description Whether a usable session to the daemon is currently open.
   * @returns {boolean} True when the integration can send and receive.
   * @example
   * if (daemon.connected) { … }
   */
  get connected() {
    return this.client !== null;
  }

  /**
   * @description Open (or re-open) the session to the Olvid daemon. Never
   * throws: a daemon that is down is a transient state, retried in the
   * background, and reported to the Configuration screen.
   * @param {object} config - Normalized integration configuration.
   * @returns {Promise<void>} Resolves once the first attempt settled.
   * @example
   * await daemon.start(config);
   */
  async start(config) {
    await this.stop();
    this.stopping = false;
    // Own copy: the session stores the client key it mints in there, and the
    // caller's configuration object is not ours to mutate.
    this.config = { ...config };
    this.reconnectAttempts = 0;
    await this.connectWithRetry();
  }

  /**
   * @description Close the session: cancel the notification streams, stop the
   * timers, drop the clients. Safe to call when nothing is open.
   * @returns {Promise<void>} Resolves once everything is released.
   * @example
   * await daemon.stop();
   */
  async stop() {
    this.stopping = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.teardownSession();
  }

  // --- Connection lifecycle --------------------------------------------------

  async connectWithRetry() {
    if (this.stopping) {
      return;
    }
    try {
      await this.connect();
      this.reconnectAttempts = 0;
      this.reconnecting = false;
      logger.info(`Connected to the Olvid daemon as "${this.identity.displayName}"`);
      await this.notifyStatus(true);
    } catch (e) {
      this.reconnectAttempts += 1;
      const reason = describeOlvidError(e);
      logger.error(`Connection to the Olvid daemon failed: ${reason}`);
      this.teardownSession();
      await this.notifyStatus(false, {
        en: `Olvid daemon unreachable: ${reason}`,
        fr: `Démon Olvid injoignable : ${reason}`,
      });
      this.scheduleReconnect();
    }
  }

  scheduleReconnect() {
    if (this.stopping || this.reconnectTimer) {
      return;
    }
    const delay = reconnectDelay(this.reconnectAttempts);
    logger.info(`Next connection attempt in ${Math.round(delay / 1000)} s`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connectWithRetry().catch((e) => logger.error('Reconnection failed', e));
    }, delay);
    // Do not hold the event loop open just to retry.
    this.reconnectTimer.unref?.();
  }

  handleConnectionLost(error) {
    if (this.stopping || this.reconnecting) {
      return;
    }
    this.reconnecting = true;
    logger.error(`Lost the connection to the Olvid daemon: ${describeOlvidError(error)}`);
    this.teardownSession();
    this.notifyStatus(false, {
      en: 'Connection to the Olvid daemon lost, reconnecting…',
      fr: 'Connexion au démon Olvid perdue, reconnexion en cours…',
    }).catch(() => {});
    this.scheduleReconnect();
  }

  async connect() {
    const config = this.config;
    const daemonUrl = config.daemon_url;

    // 1) The admin key drives the daemon itself (profiles, client keys).
    const adminClient = this.createAdminClient({
      daemonUrl,
      clientKey: config.admin_client_key,
    });
    await adminClient.authenticationAdminTest();

    // 2) Pick the Olvid profile to drive, creating it when the daemon is empty.
    const identity = await this.resolveIdentity(adminClient, config);
    adminClient.currentIdentityId = Number(identity.id);

    // 3) The integration then works with an identity-scoped client key, so a
    // bug here can never reach another profile of the daemon.
    const clientKey = await this.resolveClientKey(adminClient, identity, config);
    const client = this.createClient({ daemonUrl, clientKey });
    await client.authenticationTest();

    this.adminClient = adminClient;
    this.client = client;
    this.identity = identity;

    await this.applyInvitationSettings();
    await this.refreshContacts();
    this.subscribe();
    this.startHealthChecks();
    await this.catchUpUnreadMessages();
  }

  teardownSession() {
    for (const cancel of this.subscriptions) {
      try {
        cancel?.();
      } catch (e) {
        logger.debug('Notification stream already closed', e);
      }
    }
    this.subscriptions = [];

    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
    try {
      this.client?.stop();
    } catch (e) {
      logger.debug('Olvid client already stopped', e);
    }
    this.client = null;
    this.adminClient = null;
    this.contactIdByKey.clear();
    this.contactKeyById.clear();
    this.contactNameById.clear();
    this.discussionIdByContactId.clear();
  }

  startHealthChecks() {
    this.healthTimer = setInterval(() => {
      const client = this.client;
      if (!client) {
        return;
      }
      client.ping().catch((e) => this.handleConnectionLost(e));
    }, HEALTH_CHECK_INTERVAL_MS);
    this.healthTimer.unref?.();
  }

  async notifyStatus(connected, message) {
    try {
      await this.onConnectionChange(connected, message);
    } catch (e) {
      logger.error('Reporting the connection status to Gladys failed', e);
    }
  }

  // --- Provisioning ----------------------------------------------------------

  async resolveIdentity(adminClient, config) {
    const identities = [];
    for await (const identity of adminClient.adminIdentityList()) {
      identities.push(identity);
    }

    if (config.identity_id) {
      const found = identities.find((identity) => Number(identity.id) === config.identity_id);
      if (!found) {
        throw new Error(`no Olvid profile #${config.identity_id} on this daemon`);
      }
      return found;
    }

    if (identities.length > 0) {
      return identities[0];
    }

    // Empty daemon: create a regular Olvid profile. No configuration link and
    // no Keycloak binding here — this is the consumer ("particulier") Olvid,
    // the very same kind of profile the mobile app creates.
    logger.info('No profile on the daemon yet, creating one');
    const identityDetails = create(datatypes.IdentityDetailsSchema, {
      firstName: config.profile_first_name,
      lastName: config.profile_last_name,
    });
    return adminClient.adminIdentityNew({ identityDetails });
  }

  async resolveClientKey(adminClient, identity, config) {
    const daemonUrl = config.daemon_url;

    // The key we minted on a previous run, stored in the integration config.
    if (config.client_key) {
      try {
        await this.createClient({ daemonUrl, clientKey: config.client_key }).authenticationTest();
        return config.client_key;
      } catch (e) {
        logger.warn(`The stored client key is no longer valid (${describeOlvidError(e)})`);
      }
    }

    // A key left by a previous install of the integration on the same daemon.
    for await (const key of adminClient.adminClientKeyList()) {
      if (key.name === CLIENT_KEY_NAME && key.identityId === identity.id) {
        logger.info('Reusing the existing Gladys client key of this profile');
        await this.persistClientKey(key.key);
        return key.key;
      }
    }

    logger.info('Creating a client key for Gladys on this profile');
    const created = await adminClient.adminClientKeyNew({
      name: CLIENT_KEY_NAME,
      identityId: identity.id,
    });
    await this.persistClientKey(created.key);
    return created.key;
  }

  // Store the key BOTH in the live config (so a reconnection reuses it without
  // a round trip) and in the Gladys config (so a restart does).
  async persistClientKey(clientKey) {
    this.config.client_key = clientKey;
    await this.saveClientKey(clientKey);
  }

  /**
   * @description Mirror the "accept invitations automatically" preference onto
   * the Olvid profile. Group invitations are never accepted: the channel is
   * one-to-one, and a group is a place where a third party could speak with
   * the authority of the linked user.
   * @returns {Promise<void>} Resolves once the daemon stored the settings.
   * @example
   * await daemon.applyInvitationSettings();
   */
  async applyInvitationSettings() {
    this.assertConnected();
    const enabled = Boolean(this.config.auto_accept_invitations);
    const identitySettings = await this.client.settingsIdentityGet();
    identitySettings.invitation = create(datatypes.IdentitySettings_AutoAcceptInvitationSchema, {
      autoAcceptInvitation: enabled,
      autoAcceptOneToOne: enabled,
      autoAcceptIntroduction: enabled,
      autoAcceptGroup: false,
    });
    await this.client.settingsIdentitySet({ identitySettings });
  }

  /**
   * @description Take a configuration change that does not require rebuilding
   * the session (the profile name, the invitation preference) into account.
   * @param {object} config - Normalized integration configuration.
   * @returns {Promise<void>} Resolves once the daemon is in sync.
   * @example
   * await daemon.updateSettings(config);
   */
  async updateSettings(config) {
    this.config = {
      ...config,
      // Never lose the key we minted: it is stored asynchronously in Gladys.
      client_key: config.client_key || this.config?.client_key || '',
      // Nor the address and key of the daemon in use. They can be absent from
      // the user configuration (the managed daemon resolves them at startup),
      // and a change of either restarts the session through requiresReconnect
      // instead of landing here — so whatever we already hold is the truth.
      daemon_url: config.daemon_url || this.config?.daemon_url || '',
      admin_client_key: config.admin_client_key || this.config?.admin_client_key || '',
    };
    if (this.client) {
      await this.applyInvitationSettings();
    }
  }

  // --- Contacts --------------------------------------------------------------

  async refreshContacts() {
    this.contactIdByKey.clear();
    this.contactKeyById.clear();
    this.contactNameById.clear();
    for await (const contact of this.client.contactList()) {
      await this.rememberContact(contact);
    }
    logger.info(`${this.contactIdByKey.size} Olvid contact(s) known by this profile`);
  }

  async rememberContact(contact) {
    const bytesIdentifier = await this.client.contactGetBytesIdentifier({ contactId: contact.id });
    const contactKey = encodeContactKey(bytesIdentifier);
    this.contactIdByKey.set(contactKey, contact.id);
    this.contactKeyById.set(String(contact.id), contactKey);
    this.contactNameById.set(String(contact.id), contact.displayName);
    return contactKey;
  }

  async contactKeyFor(contactId) {
    const known = this.contactKeyById.get(String(contactId));
    if (known) {
      return known;
    }
    const contact = await this.client.contactGet({ contactId });
    return this.rememberContact(contact);
  }

  async contactIdFor(contactKey) {
    const known = this.contactIdByKey.get(contactKey);
    if (known !== undefined) {
      return known;
    }
    // A contact created while we were offline, or a Gladys link older than the
    // current cache: rebuild it once before giving up.
    await this.refreshContacts();
    const found = this.contactIdByKey.get(contactKey);
    if (found === undefined) {
      throw new Error(`unknown Olvid contact ${shortenContactKey(contactKey)}`);
    }
    return found;
  }

  async discussionIdFor(contactId) {
    const cached = this.discussionIdByContactId.get(String(contactId));
    if (cached !== undefined) {
      return cached;
    }
    const discussion = await this.client.discussionGetByContact({ contactId });
    this.discussionIdByContactId.set(String(contactId), discussion.id);
    return discussion.id;
  }

  // --- Incoming messages -----------------------------------------------------

  subscribe() {
    const client = this.client;
    const onStreamEnd = (name) => (error) => {
      if (error) {
        logger.debug(`Notification stream "${name}" ended with an error`);
        this.handleConnectionLost(error);
      }
    };

    this.subscriptions.push(
      client.onMessageReceived({
        callback: (message) =>
          this.handleIncomingMessage(message).catch((e) =>
            logger.error(`Handling an incoming Olvid message failed: ${describeOlvidError(e)}`),
          ),
        endCallback: onStreamEnd('message-received'),
      }),
      client.onContactNew({
        callback: (contact) =>
          this.rememberContact(contact)
            .then(() => logger.info(`New Olvid contact: ${contact.displayName}`))
            .catch((e) => logger.error('Caching a new contact failed', e)),
        endCallback: onStreamEnd('contact-new'),
      }),
      client.onInvitationReceived({
        callback: (invitation) => this.logInvitation(invitation),
        endCallback: onStreamEnd('invitation-received'),
      }),
      client.onInvitationUpdated({
        callback: (invitation) => this.logInvitation(invitation),
        endCallback: onStreamEnd('invitation-updated'),
      }),
    );
  }

  logInvitation(invitation) {
    const status = datatypes.Invitation_Status[invitation.status] ?? invitation.status;
    if (SAS_STATUSES.has(invitation.status)) {
      logger.info(
        `Invitation #${invitation.id} from "${invitation.displayName}" waits for the SAS exchange ` +
          `(code to type in Olvid: ${invitation.sas ?? 'unknown'})`,
      );
      return;
    }
    logger.info(`Invitation #${invitation.id} from "${invitation.displayName}": ${status}`);
  }

  /**
   * @description Catch up on the messages received while the integration was
   * down. The daemon keeps them unread until a client reads them, so a restart
   * never silently drops what a user asked for.
   * @returns {Promise<void>} Resolves once the backlog has been routed.
   * @example
   * await daemon.catchUpUnreadMessages();
   */
  async catchUpUnreadMessages() {
    const backlog = [];
    for await (const message of this.client.messageList({ unread: true })) {
      if (message.senderId !== 0n) {
        backlog.push(message);
      }
    }
    if (backlog.length === 0) {
      return;
    }
    logger.info(`${backlog.length} message(s) received while offline, processing them now`);
    // Oldest first, so the conversation keeps its order in the Gladys history.
    backlog.sort((a, b) => Number(a.timestamp - b.timestamp));
    for (const message of backlog) {
      try {
        await this.handleIncomingMessage(message);
      } catch (e) {
        logger.error(`Processing an offline message failed: ${describeOlvidError(e)}`);
      }
    }
  }

  async handleIncomingMessage(message) {
    // sender_id is 0 for the messages WE sent: the daemon notifies both.
    if (message.senderId === 0n) {
      return;
    }

    const discussion = await this.client.discussionGet({ discussionId: message.discussionId });
    if (discussion.identifier.case !== 'contactId') {
      // Group discussions are out of scope: an incoming message carries the
      // authority of the linked Gladys user, which must stay one-to-one.
      logger.info(`Ignoring a message from the group discussion "${discussion.title}"`);
      return;
    }

    const contactKey = await this.contactKeyFor(message.senderId);
    const contactName = this.contactNameById.get(String(message.senderId)) ?? discussion.title;
    const timestamp = Number(message.timestamp);

    await this.onIncomingMessage({
      contactKey,
      contactName,
      text: message.body ?? '',
      attachmentsCount: Number(message.attachmentsCount ?? 0),
      receivedAt: Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp) : new Date(),
    });
  }

  // --- Outgoing messages -----------------------------------------------------

  /**
   * @description Deliver a message to a contact in their one-to-one Olvid
   * discussion. A long text is split into several messages, and an image
   * coming from Gladys is sent as an attachment of the first one.
   * @param {string} contactKey - Contact id as known by Gladys.
   * @param {{ text?: string, file?: string }} message - Message to deliver.
   * @returns {Promise<void>} Resolves once the daemon accepted the message.
   * @example
   * await daemon.sendMessage(contactKey, { text: 'The garage door is open' });
   */
  async sendMessage(contactKey, { text, file } = {}) {
    if (!this.client) {
      throw new Error('not connected to the Olvid daemon');
    }
    const contactId = await this.contactIdFor(contactKey);
    const discussionId = await this.discussionIdFor(contactId);
    const chunks = splitOutgoing(text);
    const attachment = decodeImageAttachment(file);

    if (chunks.length === 0 && !attachment) {
      throw new Error('nothing to send: the message has neither text nor image');
    }

    if (attachment) {
      await this.client.messageSendWithAttachments({
        discussionId,
        body: chunks.shift(),
        attachments: [attachment],
      });
    }
    for (const chunk of chunks) {
      await this.client.messageSend({ discussionId, body: chunk });
    }
  }

  // --- Invitations (the "particulier" way of meeting the bot) ----------------

  /**
   * @description The invitation link of the Gladys profile: the user opens it
   * in their Olvid app to invite the bot, exactly as they would invite a friend.
   * @returns {Promise<string>} The `https://invitation.olvid.io/…` link.
   * @example
   * const link = await daemon.getInvitationLink();
   */
  async getInvitationLink() {
    this.assertConnected();
    return this.client.identityGetInvitationLink();
  }

  /**
   * @description The invitations currently in flight on the profile, with the
   * SAS code to read out when the protocol asks for it.
   * @returns {Promise<Array<{ id: bigint, status: string, displayName: string, sas: string|null, waitsForSas: boolean }>>} The pending invitations.
   * @example
   * const invitations = await daemon.listInvitations();
   */
  async listInvitations() {
    this.assertConnected();
    const invitations = [];
    for await (const invitation of this.client.invitationList()) {
      invitations.push({
        id: invitation.id,
        status: datatypes.Invitation_Status[invitation.status] ?? String(invitation.status),
        displayName: invitation.displayName,
        sas: invitation.sas || null,
        waitsForSas: SAS_STATUSES.has(invitation.status),
        acceptable: ACCEPTABLE_STATUSES.has(invitation.status),
      });
    }
    return invitations;
  }

  /**
   * @description Accept every invitation waiting for us — the manual
   * counterpart of the "accept automatically" setting, for users who turned it
   * off. Group invitations are never accepted.
   * @returns {Promise<string[]>} The names of the invitations that were accepted.
   * @example
   * const accepted = await daemon.acceptPendingInvitations();
   */
  async acceptPendingInvitations() {
    this.assertConnected();
    const accepted = [];
    for (const invitation of await this.listInvitations()) {
      if (!invitation.acceptable) {
        continue;
      }
      await this.client.invitationAccept({ invitationId: invitation.id });
      accepted.push(invitation.displayName);
    }
    return accepted;
  }

  /**
   * @description Complete the trust establishment by submitting the 4-digit
   * code displayed by the user's Olvid app. Olvid deliberately never automates
   * this step: it is what proves the two identities really met.
   * @param {{ invitationId?: bigint|number, sas: string }} params - Invitation and code.
   * @returns {Promise<{ id: bigint, displayName: string }>} The invitation the code was applied to.
   * @example
   * await daemon.submitSas({ sas: '1234' });
   */
  async submitSas({ invitationId, sas }) {
    this.assertConnected();
    const code = String(sas ?? '').trim();
    if (!/^\d{4}$/.test(code)) {
      throw new Error('the SAS code is the 4 digits displayed by your Olvid app');
    }

    const invitations = await this.listInvitations();
    const waiting = invitations.filter((invitation) => invitation.waitsForSas);
    let target;
    if (invitationId) {
      target = invitations.find((invitation) => invitation.id === BigInt(invitationId));
      if (!target) {
        throw new Error(`no pending invitation #${invitationId}`);
      }
    } else if (waiting.length === 1) {
      target = waiting[0];
    } else if (waiting.length === 0) {
      throw new Error('no invitation is waiting for a SAS code');
    } else {
      throw new Error(
        `${waiting.length} invitations are waiting for a code: give the invitation number too`,
      );
    }

    await this.client.invitationSas({ invitationId: target.id, sas: code });
    return { id: target.id, displayName: target.displayName };
  }

  /**
   * @description A snapshot of the Olvid side, for the "Test the connection"
   * button of the Configuration screen.
   * @returns {Promise<{ version: string, profile: string, identityId: number, contacts: number, pendingInvitations: number }>} The report.
   * @example
   * const report = await daemon.describeStatus();
   */
  async describeStatus() {
    this.assertConnected();
    const version = await this.client.daemonVersion();
    const identity = await this.client.identityGet();
    const invitations = await this.listInvitations();
    return {
      version,
      profile: identity.displayName,
      identityId: Number(identity.id),
      contacts: this.contactIdByKey.size,
      pendingInvitations: invitations.length,
    };
  }

  assertConnected() {
    if (!this.client) {
      throw new Error('not connected to the Olvid daemon');
    }
  }
}

/**
 * @description Delay before the next connection attempt: a steady base delay
 * while the daemon may simply be booting, then the usual exponential backoff
 * for what looks like a durable failure (a daemon that is down, a wrong URL).
 * @param {number} attempts - Consecutive failed attempts, starting at 1.
 * @returns {number} Delay in milliseconds.
 * @example
 * reconnectDelay(1); // 5000
 */
export function reconnectDelay(attempts) {
  const exponent = Math.min(Math.max(attempts - RECONNECT_STEADY_ATTEMPTS, 0), 6);
  return Math.min(RECONNECT_BASE_DELAY_MS * 2 ** exponent, RECONNECT_MAX_DELAY_MS);
}

/**
 * @description Build a one-line description of an error raised by the daemon:
 * a gRPC failure carries its status in a `code` the message does not repeat.
 * @param {any} error - Error thrown by the Olvid client, or anything else.
 * @returns {string} A human readable reason.
 * @example
 * describeOlvidError(error); // '[unavailable] connection refused'
 */
export function describeOlvidError(error) {
  if (!error) {
    return 'unknown error';
  }
  if (typeof error.code === 'string' && error.message) {
    return `${error.message} (${error.code})`;
  }
  return error.message || String(error);
}
