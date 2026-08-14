// -----------------------------------------------------------------------------
// The daemon Gladys runs itself (manifest `containers`). What matters here is
// the admin key: it is generated once, persisted BEFORE the container starts,
// and reused as-is afterwards — a key we would forget leaves a daemon nobody
// can authenticate against.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { apiError, createFakeGladys } from './helpers/fakeGladys.js';
import {
  ADMIN_KEY_ENV,
  DAEMON_CONTAINER_NAME,
  MANAGED_DAEMON_URL,
  describeContainerError,
  generateAdminClientKey,
  startManagedDaemon,
} from '../src/olvid/container.js';

test('the first run generates an admin key, persists it, then starts the daemon', async () => {
  const gladys = createFakeGladys();
  // The fake records into `gladys.calls`: writing the save there too gives one
  // timeline, and lets the test assert the ORDER of the two operations.
  const events = gladys.calls;
  const saved = [];

  const managed = await startManagedDaemon({
    gladys,
    adminClientKey: '',
    saveAdminClientKey: async (key) => {
      saved.push(key);
      events.push({ method: 'saveAdminClientKey' });
    },
  });

  assert.equal(managed.daemon_url, MANAGED_DAEMON_URL);
  assert.match(managed.admin_client_key, /^[0-9a-f]{64}$/);
  assert.deepEqual(saved, [managed.admin_client_key]);

  const start = events.find((call) => call.method === 'startContainer');
  assert.equal(start.name, DAEMON_CONTAINER_NAME);
  assert.equal(start.env[ADMIN_KEY_ENV], managed.admin_client_key);

  // Persisted BEFORE the start: a container started with a key we forgot is a
  // daemon nobody can authenticate against, and only a recreation fixes it.
  assert.deepEqual(
    events.map((call) => call.method),
    ['saveAdminClientKey', 'startContainer'],
  );
});

test('the next runs reuse the stored key without generating a new one', async () => {
  const gladys = createFakeGladys();
  const saved = [];

  const managed = await startManagedDaemon({
    gladys,
    adminClientKey: 'a-key-from-a-previous-run',
    saveAdminClientKey: async (key) => saved.push(key),
  });

  assert.equal(managed.admin_client_key, 'a-key-from-a-previous-run');
  assert.deepEqual(saved, [], 'a stored key must not be regenerated');
  // Same env as the running container: the supervisor keeps it as-is.
  const start = gladys.calls.find((call) => call.method === 'startContainer');
  assert.equal(start.env[ADMIN_KEY_ENV], 'a-key-from-a-previous-run');
});

test('a blank stored key is treated as no key at all', async () => {
  const gladys = createFakeGladys();
  const saved = [];

  const managed = await startManagedDaemon({
    gladys,
    adminClientKey: '   ',
    saveAdminClientKey: async (key) => saved.push(key),
  });

  assert.match(managed.admin_client_key, /^[0-9a-f]{64}$/);
  assert.deepEqual(saved, [managed.admin_client_key]);
});

test('generated keys are unique', () => {
  const keys = new Set(Array.from({ length: 50 }, () => generateAdminClientKey()));
  assert.equal(keys.size, 50);
});

test('a failing start propagates, so the caller can report it in the UI', async () => {
  const gladys = createFakeGladys({ startContainerError: apiError(500, 'image pull failed') });

  await assert.rejects(
    startManagedDaemon({ gladys, adminClientKey: 'k', saveAdminClientKey: async () => {} }),
    /image pull failed/,
  );
});

test('describeContainerError names the two situations a user can act on', () => {
  const tooOld = describeContainerError(apiError(404, 'unknown container'));
  assert.match(tooOld.en, /Update Gladys/);
  assert.match(tooOld.fr, /Mettez Gladys à jour/);

  const other = describeContainerError(new Error('image pull failed'));
  assert.match(other.en, /image pull failed/);
  assert.match(other.fr, /image pull failed/);
});
