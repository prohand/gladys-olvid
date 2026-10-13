import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildActions } from '../src/actions.js';

const LANGUAGES = ['en', 'fr', 'de', 'es'];

const daemon = {
  describeStatus: async () => ({
    version: '2.0.1',
    profile: 'Gladys Assistant',
    identityId: 1,
    contacts: 2,
    pendingInvitations: 1,
  }),
  getInvitationLink: async () => 'https://invitation.olvid.io/#abc',
  listInvitations: async () => [
    { id: 3, displayName: 'John', status: 'waiting', waitsForSas: true, sas: '1234' },
    { id: 4, displayName: 'Jane', status: 'sent', waitsForSas: false },
  ],
  acceptPendingInvitations: async () => ['John'],
  submitSas: async () => ({ id: 3, displayName: 'John' }),
};

test('every action answers in every language of Gladys', async () => {
  const actions = buildActions({ daemon });
  for (const [key, run] of Object.entries(actions)) {
    const message = await run({ sas: '1234' });
    assert.deepEqual(Object.keys(message), LANGUAGES, `action "${key}"`);
    for (const language of LANGUAGES) {
      assert.ok(message[language].length > 0, `action "${key}" has no "${language}" text`);
    }
  }
});

test('the invitations list gives the code to type, in each language', async () => {
  const message = await buildActions({ daemon }).pending_invitations();
  assert.match(message.en, /^#3 John — waiting — code to type in Olvid: 1234\n#4 Jane — sent$/);
  assert.match(message.de, /in Olvid einzugebender Code: 1234/);
  assert.match(message.es, /código que debe introducir en Olvid: 1234/);
});
