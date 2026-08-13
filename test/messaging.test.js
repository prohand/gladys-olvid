import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  handleIncomingMessage,
  looksLikeLinkCode,
  refreshContactLanguages,
} from '../src/messaging.js';
import { createFakeDaemon, createFakeGladys } from './helpers/fakeGladys.js';

const CONTACT = 'AQAAAGdlbmVyaWM';

const incoming = (text, overrides = {}) => ({
  contactKey: CONTACT,
  contactName: 'John',
  text,
  attachmentsCount: 0,
  receivedAt: new Date('2026-01-02T03:04:05.000Z'),
  ...overrides,
});

test('looksLikeLinkCode accepts a short code and rejects a sentence', () => {
  assert.equal(looksLikeLinkCode('AB23CD45'), true);
  assert.equal(looksLikeLinkCode('ab23-cd45'), true);
  assert.equal(looksLikeLinkCode('turn on the light'), false);
  assert.equal(looksLikeLinkCode('quelle est la température ?'), false);
  assert.equal(looksLikeLinkCode(''), false);
});

test('a message from a linked contact is published to the brain', async () => {
  const gladys = createFakeGladys({ linkedContacts: new Set([CONTACT]) });
  const daemon = createFakeDaemon();

  await handleIncomingMessage(
    { gladys, daemon, languages: new Map() },
    incoming('turn on the light'),
  );

  const published = gladys.calls.find((c) => c.method === 'publishMessage');
  assert.equal(published.text, 'turn on the light');
  assert.equal(published.options.createdAt.toISOString(), '2026-01-02T03:04:05.000Z');
  assert.equal(daemon.sent.length, 0, 'nothing is written back: the brain answers');
});

test('an unlinked contact gets the linking instructions, in both languages', async () => {
  const gladys = createFakeGladys();
  const daemon = createFakeDaemon();

  await handleIncomingMessage({ gladys, daemon, languages: new Map() }, incoming('hello Gladys'));

  assert.equal(daemon.sent.length, 1);
  assert.match(daemon.sent[0].text, /not linked/);
  assert.match(daemon.sent[0].text, /pas encore liée?/);
});

test('a valid code links the contact and greets the user in their language', async () => {
  const gladys = createFakeGladys({
    codes: new Map([['AB23CD45', { selector: 'john', first_name: 'John', language: 'fr' }]]),
  });
  const daemon = createFakeDaemon();
  const languages = new Map();

  await handleIncomingMessage({ gladys, daemon, languages }, incoming('AB23CD45'));

  assert.deepEqual(
    gladys.calls.map((c) => c.method),
    ['linkContact'],
    'a plausible code is tried as a code first',
  );
  assert.equal(languages.get(CONTACT), 'fr');
  assert.match(daemon.sent[0].text, /Compte lié à John/);
});

test('a code-looking message from a linked contact still reaches the brain', async () => {
  const gladys = createFakeGladys({ linkedContacts: new Set([CONTACT]) });
  const daemon = createFakeDaemon();

  await handleIncomingMessage({ gladys, daemon, languages: new Map() }, incoming('ok'));

  // "ok" is too short to look like a code: straight to the brain.
  assert.deepEqual(
    gladys.calls.map((c) => c.method),
    ['publishMessage'],
  );

  await handleIncomingMessage({ gladys, daemon, languages: new Map() }, incoming('salon'));
  assert.deepEqual(
    gladys.calls.map((c) => c.method),
    ['publishMessage', 'linkContact', 'publishMessage'],
    'an invalid code falls back to the brain',
  );
  assert.equal(daemon.sent.length, 0);
});

test('an expired code is reported as such, not as an unlinked account', async () => {
  const gladys = createFakeGladys();
  const daemon = createFakeDaemon();

  await handleIncomingMessage({ gladys, daemon, languages: new Map() }, incoming('AB23CD45'));

  assert.match(daemon.sent[0].text, /invalid or expired/);
});

test('an attachment is acknowledged as ignored, in the language of the user', async () => {
  const gladys = createFakeGladys({ linkedContacts: new Set([CONTACT]) });
  const daemon = createFakeDaemon();
  const languages = new Map([[CONTACT, 'fr']]);

  await handleIncomingMessage(
    { gladys, daemon, languages },
    incoming('regarde cette photo', { attachmentsCount: 1 }),
  );

  assert.equal(gladys.calls.length, 1);
  assert.match(daemon.sent[0].text, /pièce jointe a été ignorée/);
});

test('an empty message is dropped without calling Gladys', async () => {
  const gladys = createFakeGladys({ linkedContacts: new Set([CONTACT]) });
  const daemon = createFakeDaemon();

  await handleIncomingMessage({ gladys, daemon, languages: new Map() }, incoming('   '));

  assert.equal(gladys.calls.length, 0);
  assert.equal(daemon.sent.length, 0);
});

test('a message longer than the Gladys limit is truncated, not rejected', async () => {
  const gladys = createFakeGladys({ linkedContacts: new Set([CONTACT]) });
  const daemon = createFakeDaemon();

  await handleIncomingMessage({ gladys, daemon, languages: new Map() }, incoming('a'.repeat(5000)));

  assert.equal(gladys.calls[0].text.length, 4096);
});

test('refreshContactLanguages maps the contacts to the language of their user', async () => {
  const gladys = createFakeGladys({
    contacts: [
      { contact_id: CONTACT, contact_name: 'John', user: { first_name: 'John', language: 'fr' } },
      { contact_id: 'other', contact_name: 'Jane', user: { first_name: 'Jane', language: 'en' } },
    ],
  });
  const languages = new Map([['stale', 'fr']]);

  await refreshContactLanguages(gladys, languages);

  assert.deepEqual(
    [...languages.entries()],
    [
      [CONTACT, 'fr'],
      ['other', 'en'],
    ],
  );
});
