import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MAX_INCOMING_LENGTH, splitOutgoing, truncateIncoming } from '../src/text.js';
import { decodeImageAttachment } from '../src/olvid/attachments.js';
import { encodeContactKey, shortenContactKey } from '../src/olvid/identifiers.js';
import { channelText, normalizeLanguage } from '../src/i18n.js';

test('truncateIncoming leaves a normal message untouched', () => {
  assert.equal(truncateIncoming('hello'), 'hello');
  assert.equal(truncateIncoming(undefined), '');
});

test('truncateIncoming caps a long message at what publishMessage accepts', () => {
  const truncated = truncateIncoming('a'.repeat(MAX_INCOMING_LENGTH + 100));
  assert.equal(truncated.length, MAX_INCOMING_LENGTH);
  assert.ok(truncated.endsWith('…'));
});

test('splitOutgoing keeps a short answer in a single message', () => {
  assert.deepEqual(splitOutgoing('  the light is on  '), ['the light is on']);
  assert.deepEqual(splitOutgoing(''), []);
  assert.deepEqual(splitOutgoing(null), []);
});

test('splitOutgoing cuts a long answer on a separator, not mid-word', () => {
  const text = `${'word '.repeat(20).trim()}\n${'other '.repeat(20).trim()}`;
  const chunks = splitOutgoing(text, 60);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) {
    assert.ok(chunk.length <= 60, `chunk too long: ${chunk.length}`);
  }
  assert.equal(chunks.join(' ').replace(/\s+/g, ' '), text.replace(/\s+/g, ' '));
});

test('splitOutgoing still cuts a single unbreakable block', () => {
  const chunks = splitOutgoing('a'.repeat(130), 50);
  assert.deepEqual(
    chunks.map((chunk) => chunk.length),
    [50, 50, 30],
  );
});

test('decodeImageAttachment accepts the Gladys camera prefixes and raw base64', () => {
  const payload = Buffer.from('hello').toString('base64');
  assert.deepEqual(decodeImageAttachment(`image/jpg;base64,${payload}`).filename, 'gladys.jpg');
  assert.deepEqual(
    decodeImageAttachment(`data:image/png;base64,${payload}`).filename,
    'gladys.png',
  );
  const raw = decodeImageAttachment(payload);
  assert.equal(raw.filename, 'gladys.jpg');
  assert.equal(Buffer.from(raw.payload).toString(), 'hello');
});

test('decodeImageAttachment returns null when there is no image', () => {
  assert.equal(decodeImageAttachment(null), null);
  assert.equal(decodeImageAttachment(''), null);
  assert.equal(decodeImageAttachment('   '), null);
});

test('a contact id is the base64url of the Olvid bytes identifier', () => {
  const key = encodeContactKey(new Uint8Array([251, 255, 190, 0]));
  assert.equal(key, '-_--AA');
  assert.ok(!key.includes('+') && !key.includes('/'), 'URL-safe alphabet');
  assert.equal(shortenContactKey('AQAAAGdlbmVyaWM'), 'AQAAAGdl…');
  assert.equal(shortenContactKey('short'), 'short');
});

test('channelText answers in the language of the user, both when unknown', () => {
  assert.match(channelText('not_linked', 'fr'), /^Votre compte Olvid/);
  assert.match(channelText('not_linked', 'en-US'), /^Your Olvid account/);
  const bilingual = channelText('not_linked', null);
  assert.match(bilingual, /Your Olvid account/);
  assert.match(bilingual, /Votre compte Olvid/);
});

test('channelText interpolates the parameters of a text', () => {
  assert.match(channelText('link_success', 'en', { firstName: 'John' }), /linked to John/);
});

test('normalizeLanguage reduces a locale to a supported language', () => {
  assert.equal(normalizeLanguage('fr-FR'), 'fr');
  assert.equal(normalizeLanguage('EN'), 'en');
  assert.equal(normalizeLanguage('de'), null);
  assert.equal(normalizeLanguage(undefined), null);
});
