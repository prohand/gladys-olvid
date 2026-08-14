import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DAEMON_MODES,
  DEFAULT_CONFIG,
  INTERNAL_CONFIG_KEYS,
  isConfigured,
  isManagedDaemon,
  normalizeConfig,
  requiresReconnect,
} from '../src/config.js';

test('normalizeConfig returns the defaults, plus the internal keys', () => {
  const config = normalizeConfig();
  for (const [key, value] of Object.entries(DEFAULT_CONFIG)) {
    assert.equal(config[key], value, `default ${key}`);
  }
  for (const key of INTERNAL_CONFIG_KEYS) {
    assert.equal(config[key], '');
  }
});

test('normalizeConfig keeps user values over the defaults', () => {
  const config = normalizeConfig({
    daemon_mode: DAEMON_MODES.EXTERNAL,
    daemon_url: 'https://olvid.lan:50051',
    admin_client_key: 'secret',
    identity_id: 2,
  });
  assert.equal(config.daemon_mode, DAEMON_MODES.EXTERNAL);
  assert.equal(config.daemon_url, 'https://olvid.lan:50051');
  assert.equal(config.admin_client_key, 'secret');
  assert.equal(config.identity_id, 2);
});

test('normalizeConfig coerces the types coming from a form', () => {
  const config = normalizeConfig({ identity_id: '3', daemon_url: '  http://host:50051  ' });
  assert.equal(config.identity_id, 3);
  assert.equal(config.daemon_url, 'http://host:50051');
});

test('an empty profile name falls back to the default rather than an empty identity', () => {
  const config = normalizeConfig({ profile_first_name: '   ', profile_last_name: '' });
  assert.equal(config.profile_first_name, DEFAULT_CONFIG.profile_first_name);
  assert.equal(config.profile_last_name, DEFAULT_CONFIG.profile_last_name);
});

test('auto_accept_invitations defaults to true and only an explicit false disables it', () => {
  assert.equal(normalizeConfig().auto_accept_invitations, true);
  assert.equal(normalizeConfig({ auto_accept_invitations: false }).auto_accept_invitations, false);
  assert.equal(normalizeConfig({ auto_accept_invitations: true }).auto_accept_invitations, true);
});

test('the daemon is managed by Gladys unless the user explicitly says otherwise', () => {
  assert.equal(normalizeConfig().daemon_mode, DAEMON_MODES.MANAGED);
  assert.equal(isManagedDaemon(normalizeConfig()), true);
  assert.equal(isManagedDaemon(normalizeConfig({ daemon_mode: 'external' })), false);
  // An unknown value is not a reason to stop working: fall back to managed.
  assert.equal(isManagedDaemon(normalizeConfig({ daemon_mode: 'whatever' })), true);
});

test('a managed daemon needs no configuration at all', () => {
  assert.equal(isConfigured(normalizeConfig()), true);
});

test('an external daemon requires its URL and its admin key', () => {
  const external = (raw) => isConfigured(normalizeConfig({ daemon_mode: 'external', ...raw }));
  assert.equal(external({}), false);
  assert.equal(external({ daemon_url: 'http://olvid-daemon:50051' }), false);
  assert.equal(external({ admin_client_key: 'k' }), false);
  assert.equal(external({ daemon_url: 'http://olvid-daemon:50051', admin_client_key: 'k' }), true);
});

test('requiresReconnect only fires on the keys that define the session', () => {
  const base = normalizeConfig({ admin_client_key: 'k' });
  assert.equal(requiresReconnect(base, normalizeConfig({ admin_client_key: 'k2' })), true);
  assert.equal(
    requiresReconnect(base, normalizeConfig({ admin_client_key: 'k', identity_id: 4 })),
    true,
  );
  // Switching who runs the daemon is a different daemon: rebuild the session.
  assert.equal(
    requiresReconnect(base, normalizeConfig({ admin_client_key: 'k', daemon_mode: 'external' })),
    true,
  );
  assert.equal(
    requiresReconnect(
      base,
      normalizeConfig({ admin_client_key: 'k', profile_first_name: 'Maison' }),
    ),
    false,
  );
  // The generated admin key lands in the config on the first run: reconnecting
  // there would restart the session we are precisely in the middle of opening.
  assert.equal(
    requiresReconnect(
      base,
      normalizeConfig({ admin_client_key: 'k', managed_admin_client_key: 'generated' }),
    ),
    false,
  );
});
