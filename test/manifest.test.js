// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { buildActions } from '../src/actions.js';
import { DEFAULT_CONFIG, INTERNAL_CONFIG_KEYS } from '../src/config.js';
import { DAEMON_CONTAINER_NAME, MANAGED_DAEMON_URL } from '../src/olvid/container.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

test('the manifest declares a bidirectional communication channel', () => {
  assert.equal(manifest.type, 'communication');
  assert.equal(manifest.messaging.receive, true);
  // A bidirectional channel links by code: contact_schema is for send-only ones.
  assert.equal(manifest.contact_schema, undefined);
});

test('every manifest action has a registered handler', () => {
  const handled = new Set(Object.keys(buildActions({ daemon: {} })));
  for (const action of manifest.actions ?? []) {
    assert.ok(handled.has(action.key), `manifest action "${action.key}" has no handler`);
  }
  for (const key of handled) {
    assert.ok(
      (manifest.actions ?? []).some((action) => action.key === key),
      `handler "${key}" is not declared in the manifest`,
    );
  }
});

test('config_schema defaults stay consistent with DEFAULT_CONFIG', () => {
  for (const field of manifest.config_schema) {
    if (field.default !== undefined) {
      assert.equal(
        DEFAULT_CONFIG[field.key],
        field.default,
        `DEFAULT_CONFIG.${field.key} must match the manifest default`,
      );
    }
  }
});

test('every config_schema field is known by the code', () => {
  for (const field of manifest.config_schema) {
    if (field.type === 'section') {
      continue;
    }
    assert.ok(
      field.key in DEFAULT_CONFIG,
      `config field "${field.key}" is missing in DEFAULT_CONFIG`,
    );
  }
});

test('internal config keys are never rendered in the Configuration screen', () => {
  const declared = new Set(manifest.config_schema.map((field) => field.key));
  for (const key of INTERNAL_CONFIG_KEYS) {
    assert.ok(
      !declared.has(key),
      `"${key}" is internal storage and must stay out of config_schema`,
    );
    assert.ok(!(key in DEFAULT_CONFIG), `"${key}" is internal storage, not a user default`);
  }
});

test('section fields are purely presentational', () => {
  const sections = manifest.config_schema.filter((field) => field.type === 'section');
  assert.ok(sections.length > 0);
  for (const section of sections) {
    assert.equal(section.required, undefined);
    assert.equal(section.default, undefined);
    assert.equal(section.placeholder, undefined);
    assert.ok(section.label?.en && section.label?.fr);
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//);
    }
  }
});

test('every user-facing text exists in both languages', () => {
  const texts = [
    manifest.description,
    ...manifest.config_schema.flatMap((field) => [field.label, field.description]),
    ...(manifest.actions ?? []).flatMap((action) => [
      action.label,
      action.description,
      ...(action.fields ?? []).flatMap((field) => [field.label, field.description]),
    ]),
  ].filter(Boolean);
  for (const text of texts) {
    assert.ok(text.en, `missing English text in ${JSON.stringify(text)}`);
    assert.ok(text.fr, `missing French text in ${JSON.stringify(text)}`);
  }
});

test('the manifest declares the Olvid daemon the code starts', () => {
  const [daemon, ...others] = manifest.containers;
  assert.equal(others.length, 0, 'a single sub-container is expected');
  // The name is the DNS alias on the private network: the URL the code uses to
  // reach the daemon is derived from it, so both must stay in sync.
  assert.equal(daemon.name, DAEMON_CONTAINER_NAME);
  assert.ok(MANAGED_DAEMON_URL.includes(`//${DAEMON_CONTAINER_NAME}:`));
  // The image must be pinned: "latest" would silently change the Olvid client
  // holding the user's identity.
  assert.match(daemon.docker_image, /^olvid\/bot-daemon:\d+\.\d+\.\d+$/);
  // The admin key is computed at runtime and passed to startContainer: it can
  // never appear in the manifest, which is public.
  for (const key of Object.keys(daemon.env ?? {})) {
    assert.ok(
      !key.startsWith('OLVID_ADMIN_CLIENT_KEY'),
      `"${key}" is a secret, not a manifest env`,
    );
  }
  // Started by the integration, precisely because of that key.
  assert.equal(daemon.start, 'manual');
  // The Olvid identity lives in those volumes: without them, every restart
  // would create a new profile and lose the contacts. `/daemon/backups` is
  // written by the daemon on its own, and holds a copy of that identity.
  assert.deepEqual(daemon.volumes, ['/daemon/data', '/daemon/backups']);
  // No published port: the gRPC API is admin-level, it stays on the private
  // network of the integration.
  assert.equal(daemon.ports, undefined);
});

test('the manifest version matches the docker image tag', () => {
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.ok(
    manifest.docker_image.endsWith(`:${manifest.version}`),
    'the docker_image tag must be the manifest version',
  );
});
