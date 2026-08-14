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
  createDaemonContainerWatch,
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

test('a stopped daemon container is named in the status, not just "unreachable"', async () => {
  const gladys = createFakeGladys();
  gladys.getContainers = async () => [{ name: DAEMON_CONTAINER_NAME, status: 'exited' }];
  const watch = createDaemonContainerWatch({ gladys });

  const message = await watch();

  assert.match(message.en, /exited/);
  assert.match(message.fr, /logs/);
});

test('a running daemon container explains nothing: the reason is elsewhere', async () => {
  const gladys = createFakeGladys();
  gladys.getContainers = async () => [{ name: DAEMON_CONTAINER_NAME, status: 'running' }];

  assert.equal(await createDaemonContainerWatch({ gladys })(), null);
});

test('the container state is not re-read on every retry', async () => {
  const gladys = createFakeGladys();
  let reads = 0;
  gladys.getContainers = async () => {
    reads += 1;
    return [{ name: DAEMON_CONTAINER_NAME, status: 'exited' }];
  };
  let clock = 1_000;
  const watch = createDaemonContainerWatch({ gladys, now: () => clock, intervalMs: 30_000 });

  await watch();
  clock += 5_000;
  const cached = await watch();
  assert.equal(reads, 1, 'a retry every 5 s must not read the state every 5 s');
  assert.match(cached.en, /exited/, 'the known state is still reported meanwhile');

  clock += 30_000;
  await watch();
  assert.equal(reads, 2);
});

test('a host API that cannot answer never hides the connection error', async () => {
  const gladys = createFakeGladys();
  gladys.getContainers = async () => {
    throw apiError(500, 'host API down');
  };

  assert.equal(await createDaemonContainerWatch({ gladys })(), null);
});

test('describeContainerError names the two situations a user can act on', () => {
  const tooOld = describeContainerError(apiError(404, 'unknown container'));
  assert.match(tooOld.en, /Update Gladys/);
  assert.match(tooOld.fr, /Mettez Gladys à jour/);

  const other = describeContainerError(new Error('image pull failed'));
  assert.match(other.en, /image pull failed/);
  assert.match(other.fr, /image pull failed/);
});
