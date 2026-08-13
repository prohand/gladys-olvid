import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeConfig } from '../src/config.js';
import { OlvidDaemon, describeOlvidError } from '../src/olvid/daemon.js';
import { encodeContactKey } from '../src/olvid/identifiers.js';
import { createFakeOlvid, fakeContact } from './helpers/fakeOlvid.js';

// A fresh configuration per test: a session stores the client key it mints in
// its own copy, so a shared object would leak state from one test to the next.
const config = (overrides = {}) =>
  normalizeConfig({
    daemon_url: 'http://olvid:50051',
    admin_client_key: 'admin-key',
    ...overrides,
  });

// The contact key Gladys sees: base64url of the bytes identifier the fake
// daemon derives from the contact id (see createFakeOlvid).
const contactKeyOf = (id) => encodeContactKey(new Uint8Array([0, id]));

function build(olvid, overrides = {}) {
  const received = [];
  const statuses = [];
  const savedKeys = [];
  const daemon = new OlvidDaemon({
    onIncomingMessage: async (message) => received.push(message),
    onConnectionChange: async (connected, message) => statuses.push({ connected, message }),
    saveClientKey: async (key) => savedKeys.push(key),
    createClient: olvid.createClient,
    createAdminClient: olvid.createAdminClient,
    ...overrides,
  });
  return { daemon, received, statuses, savedKeys };
}

test('an empty daemon is provisioned: profile, client key, invitation settings', async () => {
  const olvid = createFakeOlvid();
  const { daemon, savedKeys, statuses } = build(olvid);

  await daemon.start(config());

  assert.equal(olvid.state.identities.length, 1);
  assert.equal(olvid.state.identities[0].displayName, 'Gladys Assistant');
  assert.deepEqual(savedKeys, ['key-gladys-assistant-1']);
  assert.equal(olvid.adminClient.currentIdentityId, 1);
  assert.equal(olvid.state.settings.invitation.autoAcceptInvitation, true);
  assert.equal(
    olvid.state.settings.invitation.autoAcceptGroup,
    false,
    'a bot never joins a group on its own',
  );
  assert.deepEqual(statuses, [{ connected: true, message: undefined }]);

  await daemon.stop();
});

test('turning automatic acceptance off is pushed to the Olvid profile', async () => {
  const olvid = createFakeOlvid();
  const { daemon } = build(olvid);
  await daemon.start(config());
  assert.equal(olvid.state.settings.invitation.autoAcceptInvitation, true);

  await daemon.updateSettings(config({ auto_accept_invitations: false }));

  assert.equal(olvid.state.settings.invitation.autoAcceptInvitation, false);
  assert.equal(olvid.state.settings.invitation.autoAcceptOneToOne, false);
  assert.equal(
    daemon.config.client_key,
    'key-gladys-assistant-1',
    'the minted key survives a configuration update',
  );

  await daemon.stop();
});

test('an existing Gladys client key is reused instead of piling up new ones', async () => {
  const olvid = createFakeOlvid({
    identities: [{ id: 4n, displayName: 'Maison' }],
    clientKeys: [{ name: 'gladys-assistant', identityId: 4n, key: 'existing-key' }],
  });
  const { daemon, savedKeys } = build(olvid);

  await daemon.start(config());

  assert.deepEqual(savedKeys, ['existing-key']);
  assert.equal(olvid.state.clientKeys.length, 1);

  await daemon.stop();
});

test('an unknown profile number is reported instead of silently using another one', async () => {
  const olvid = createFakeOlvid({ identities: [{ id: 1n, displayName: 'Maison' }] });
  const { daemon, statuses } = build(olvid);

  await daemon.start(config({ identity_id: 9 }));

  assert.equal(daemon.connected, false);
  assert.equal(statuses.at(-1).connected, false);
  assert.match(statuses.at(-1).message.fr, /profil Olvid #9|no Olvid profile #9/);

  await daemon.stop();
});

test('a message of a one-to-one discussion is routed with a stable contact id', async () => {
  const john = fakeContact(7, 'John');
  const olvid = createFakeOlvid({ contacts: [john.contact], discussions: [john.discussion] });
  const { daemon, received } = build(olvid);
  await daemon.start(config());

  await olvid.emitMessage(john.message('turn on the light'));

  assert.equal(received.length, 1);
  assert.equal(received[0].contactKey, contactKeyOf(7));
  assert.equal(received[0].contactName, 'John');
  assert.equal(received[0].text, 'turn on the light');
  assert.equal(received[0].receivedAt.toISOString(), '2026-01-02T02:54:05.000Z');

  await daemon.stop();
});

test('our own messages and group discussions never reach Gladys', async () => {
  const john = fakeContact(7, 'John');
  const group = {
    id: 900n,
    title: 'Family',
    identifier: { case: 'groupId', value: 3n },
  };
  const olvid = createFakeOlvid({
    contacts: [john.contact],
    discussions: [john.discussion, group],
  });
  const { daemon, received } = build(olvid);
  await daemon.start(config());

  await olvid.emitMessage(john.message('sent by us', { senderId: 0n }));
  await olvid.emitMessage(john.message('from the group', { discussionId: group.id }));

  assert.equal(received.length, 0);

  await daemon.stop();
});

test('messages received while offline are replayed, oldest first', async () => {
  const john = fakeContact(7, 'John');
  const olvid = createFakeOlvid({
    contacts: [john.contact],
    discussions: [john.discussion],
    unreadMessages: [
      john.message('second', { timestamp: 2000n }),
      john.message('first', { timestamp: 1000n }),
      john.message('ours', { timestamp: 1500n, senderId: 0n }),
    ],
  });
  const { daemon, received } = build(olvid);

  await daemon.start(config());

  assert.deepEqual(
    received.map((message) => message.text),
    ['first', 'second'],
  );

  await daemon.stop();
});

test('a contact met after the connection is cached from the notification', async () => {
  const jane = fakeContact(9, 'Jane');
  const olvid = createFakeOlvid({ discussions: [jane.discussion] });
  const { daemon, received } = build(olvid);
  await daemon.start(config());

  olvid.state.contacts.push(jane.contact);
  await olvid.emitContact(jane.contact);
  await olvid.emitMessage(jane.message('hello'));

  assert.equal(received[0].contactKey, contactKeyOf(9));

  await daemon.stop();
});

test('sending a long answer splits it into several Olvid messages', async () => {
  const john = fakeContact(7, 'John');
  const olvid = createFakeOlvid({ contacts: [john.contact], discussions: [john.discussion] });
  const { daemon } = build(olvid);
  await daemon.start(config());

  await daemon.sendMessage(contactKeyOf(7), { text: 'a'.repeat(8000) });

  assert.equal(olvid.state.sentMessages.length, 3);
  assert.ok(olvid.state.sentMessages.every((message) => message.discussionId === 700n));

  await daemon.stop();
});

test('an image from Gladys is attached to the first message', async () => {
  const john = fakeContact(7, 'John');
  const olvid = createFakeOlvid({ contacts: [john.contact], discussions: [john.discussion] });
  const { daemon } = build(olvid);
  await daemon.start(config());

  await daemon.sendMessage(contactKeyOf(7), {
    text: 'Someone is at the door',
    file: `image/jpg;base64,${Buffer.from('jpeg').toString('base64')}`,
  });

  assert.equal(olvid.state.sentMessages.length, 1);
  const [sent] = olvid.state.sentMessages;
  assert.equal(sent.body, 'Someone is at the door');
  assert.equal(sent.attachments[0].filename, 'gladys.jpg');

  await daemon.stop();
});

test('sending to a contact the cache ignores refreshes it once before failing', async () => {
  const john = fakeContact(7, 'John');
  const olvid = createFakeOlvid({ discussions: [john.discussion] });
  const { daemon } = build(olvid);
  await daemon.start(config());

  // The contact appeared on the daemon while we were not listening.
  olvid.state.contacts.push(john.contact);
  await daemon.sendMessage(contactKeyOf(7), { text: 'hello' });
  assert.equal(olvid.state.sentMessages.length, 1);

  await assert.rejects(
    () => daemon.sendMessage(contactKeyOf(42), { text: 'hello' }),
    /unknown Olvid contact/,
  );

  await daemon.stop();
});

test('the SAS code is applied to the only invitation waiting for one', async () => {
  const olvid = createFakeOlvid({
    invitations: [
      { id: 3n, status: 4, displayName: 'John', sas: '9876' },
      { id: 4n, status: 2, displayName: 'Jane', sas: '' },
    ],
  });
  const { daemon } = build(olvid);
  await daemon.start(config());

  const target = await daemon.submitSas({ sas: '1234' });

  assert.equal(target.id, 3n);
  assert.deepEqual(olvid.state.sasSubmitted, { invitationId: 3n, sas: '1234' });

  const invitations = await daemon.listInvitations();
  assert.deepEqual(
    invitations.map((invitation) => invitation.waitsForSas),
    [true, false],
  );
  assert.equal(invitations[0].status, 'INVITATION_WAIT_YOU_FOR_SAS_EXCHANGE');

  await daemon.stop();
});

test('an ambiguous or malformed SAS submission is refused', async () => {
  const olvid = createFakeOlvid({
    invitations: [
      { id: 3n, status: 4, displayName: 'John', sas: '1111' },
      { id: 5n, status: 4, displayName: 'Jane', sas: '2222' },
    ],
  });
  const { daemon } = build(olvid);
  await daemon.start(config());

  await assert.rejects(() => daemon.submitSas({ sas: '12' }), /4 digits/);
  await assert.rejects(() => daemon.submitSas({ sas: '1234' }), /invitation number/);
  await assert.rejects(() => daemon.submitSas({ sas: '1234', invitationId: 42 }), /no pending/);

  const target = await daemon.submitSas({ sas: '1234', invitationId: 5 });
  assert.equal(target.displayName, 'Jane');

  await daemon.stop();
});

test('pending invitations can be accepted by hand, but never a group one', async () => {
  const olvid = createFakeOlvid({
    invitations: [
      { id: 1n, status: 1, displayName: 'John', sas: '' },
      { id: 2n, status: 10, displayName: 'Jane', sas: '' },
      { id: 3n, status: 11, displayName: 'Family group', sas: '' },
      { id: 4n, status: 4, displayName: 'Bob', sas: '4242' },
    ],
  });
  const { daemon } = build(olvid);
  await daemon.start(config());

  const accepted = await daemon.acceptPendingInvitations();

  assert.deepEqual(accepted, ['John', 'Jane']);
  assert.deepEqual(olvid.state.accepted, [1n, 2n]);

  await daemon.stop();
});

test('describeStatus reports what the Configuration screen shows', async () => {
  const john = fakeContact(7, 'John');
  const olvid = createFakeOlvid({
    identities: [{ id: 2n, displayName: 'Maison' }],
    contacts: [john.contact],
    discussions: [john.discussion],
  });
  const { daemon } = build(olvid);
  await daemon.start(config());

  assert.deepEqual(await daemon.describeStatus(), {
    version: '2.0.1',
    profile: 'Maison',
    identityId: 2,
    contacts: 1,
    pendingInvitations: 0,
  });

  await daemon.stop();
});

test('a broken notification stream tears the session down and reports it', async () => {
  const olvid = createFakeOlvid();
  const { daemon, statuses } = build(olvid);
  await daemon.start(config());

  olvid.breakStream(new Error('[unavailable] daemon is gone'));

  assert.equal(daemon.connected, false);
  assert.equal(olvid.state.stopped, true);
  assert.equal(statuses.at(-1).connected, false);
  assert.match(statuses.at(-1).message.en, /Connection to the Olvid daemon lost/);

  await daemon.stop();
});

test('an action refuses to run when the session is closed', async () => {
  const olvid = createFakeOlvid();
  const { daemon } = build(olvid);

  await assert.rejects(() => daemon.getInvitationLink(), /not connected/);
  await assert.rejects(() => daemon.sendMessage('anything', { text: 'hello' }), /not connected/);
});

test('describeOlvidError surfaces the low-level code', () => {
  const error = new Error('fetch failed');
  error.code = 'ECONNREFUSED';
  assert.equal(describeOlvidError(error), 'fetch failed (ECONNREFUSED)');
  assert.equal(describeOlvidError(new Error('[unavailable] boom')), '[unavailable] boom');
  assert.equal(describeOlvidError(null), 'unknown error');
});
