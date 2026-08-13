// -----------------------------------------------------------------------------
// In-memory stand-in for the Olvid daemon gRPC clients.
//
// It implements the handful of RPCs the integration calls, with the same shapes
// as @olvid/bot-node (bigint ids, oneof `{ case, value }` discussion
// identifiers, notification subscriptions returning a cancel function), so the
// provisioning, caching and routing logic can be tested without a daemon.
// -----------------------------------------------------------------------------

/**
 * @description Build a fake daemon and the two client factories to inject.
 * @param {object} [options] - Initial state of the daemon.
 * @param {Array} [options.identities] - Profiles already on the daemon.
 * @param {Array} [options.clientKeys] - Client keys already on the daemon.
 * @param {Array} [options.contacts] - Contacts of the profile.
 * @param {Array} [options.discussions] - Discussions of the profile.
 * @param {Array} [options.unreadMessages] - Messages waiting since the last run.
 * @param {Array} [options.invitations] - Invitations in progress.
 * @returns {object} `{ state, createClient, createAdminClient, emitMessage, emitContact }`.
 * @example
 * const olvid = createFakeOlvid({ contacts: [contact] });
 */
export function createFakeOlvid({
  identities = [],
  clientKeys = [],
  contacts = [],
  discussions = [],
  unreadMessages = [],
  invitations = [],
} = {}) {
  const state = {
    identities: [...identities],
    clientKeys: [...clientKeys],
    contacts: [...contacts],
    discussions: [...discussions],
    unreadMessages: [...unreadMessages],
    invitations: [...invitations],
    sentMessages: [],
    accepted: [],
    settings: { invitation: null },
    stopped: false,
    listeners: {},
    nextIdentityId: 1n,
  };

  const iterate = async function* (items) {
    for (const item of items) {
      yield item;
    }
  };

  const subscribe = (name) => (args) => {
    state.listeners[name] = args;
    return () => delete state.listeners[name];
  };

  const client = {
    async authenticationTest() {},
    async ping() {},
    async daemonVersion() {
      return '2.0.1';
    },
    async identityGet() {
      return state.identities[0];
    },
    async identityGetInvitationLink() {
      return 'https://invitation.olvid.io/#AAAA';
    },
    async settingsIdentityGet() {
      return { invitation: null, messageRetention: null, keycloak: null };
    },
    async settingsIdentitySet({ identitySettings }) {
      state.settings = identitySettings;
      return identitySettings;
    },
    contactList() {
      return iterate(state.contacts);
    },
    async contactGet({ contactId }) {
      const contact = state.contacts.find((c) => c.id === contactId);
      if (!contact) {
        throw new Error(`[not_found] contact ${contactId}`);
      }
      return contact;
    },
    async contactGetBytesIdentifier({ contactId }) {
      return new Uint8Array([0, Number(contactId)]);
    },
    async discussionGet({ discussionId }) {
      const discussion = state.discussions.find((d) => d.id === discussionId);
      if (!discussion) {
        throw new Error(`[not_found] discussion ${discussionId}`);
      }
      return discussion;
    },
    async discussionGetByContact({ contactId }) {
      const discussion = state.discussions.find(
        (d) => d.identifier.case === 'contactId' && d.identifier.value === contactId,
      );
      if (!discussion) {
        throw new Error(`[not_found] discussion of contact ${contactId}`);
      }
      return discussion;
    },
    messageList() {
      return iterate(state.unreadMessages);
    },
    async messageSend({ discussionId, body }) {
      state.sentMessages.push({ discussionId, body, attachments: [] });
    },
    async messageSendWithAttachments({ discussionId, body, attachments }) {
      state.sentMessages.push({ discussionId, body, attachments });
    },
    invitationList() {
      return iterate(state.invitations);
    },
    async invitationAccept({ invitationId }) {
      state.accepted.push(invitationId);
      state.invitations = state.invitations.filter((i) => i.id !== invitationId);
    },
    async invitationSas({ invitationId, sas }) {
      state.sasSubmitted = { invitationId, sas };
    },
    onMessageReceived: subscribe('message'),
    onContactNew: subscribe('contact'),
    onInvitationReceived: subscribe('invitationReceived'),
    onInvitationUpdated: subscribe('invitationUpdated'),
    stop() {
      state.stopped = true;
    },
  };

  const adminClient = {
    currentIdentityId: 0,
    async authenticationAdminTest() {},
    adminIdentityList() {
      return iterate(state.identities);
    },
    async adminIdentityNew({ identityDetails }) {
      const identity = {
        id: state.nextIdentityId++,
        displayName: `${identityDetails.firstName} ${identityDetails.lastName}`,
        details: identityDetails,
      };
      state.identities.push(identity);
      return identity;
    },
    adminClientKeyList() {
      return iterate(state.clientKeys);
    },
    async adminClientKeyNew({ name, identityId }) {
      const clientKey = { name, identityId, key: `key-${name}-${identityId}` };
      state.clientKeys.push(clientKey);
      return clientKey;
    },
  };

  return {
    state,
    client,
    adminClient,
    createClient: () => client,
    createAdminClient: () => adminClient,
    // Simulate what the daemon pushes on its notification streams.
    emitMessage: (message) => state.listeners.message.callback(message),
    emitContact: (contact) => state.listeners.contact.callback(contact),
    breakStream: (error) => state.listeners.message.endCallback(error),
  };
}

/**
 * @description Build a contact, its one-to-one discussion and a message from it.
 * @param {number} id - Daemon-local contact id.
 * @param {string} displayName - Name of the contact.
 * @returns {object} `{ contact, discussion, message(body) }`.
 * @example
 * const john = fakeContact(7, 'John');
 */
export function fakeContact(id, displayName) {
  const contactId = BigInt(id);
  const discussionId = BigInt(id * 100);
  return {
    contact: { id: contactId, displayName, hasOneToOneDiscussion: true },
    discussion: {
      id: discussionId,
      title: displayName,
      identifier: { case: 'contactId', value: contactId },
    },
    message: (body, overrides = {}) => ({
      id: { type: 1, id: 1n },
      discussionId,
      senderId: contactId,
      body,
      timestamp: 1767322445000n,
      attachmentsCount: 0n,
      ...overrides,
    }),
  };
}
