// -----------------------------------------------------------------------------
// The Olvid daemon, run BY Gladys as a sub-container.
//
// An Olvid bot needs a daemon (a full Olvid client holding the profile), and
// asking the user to write a docker-compose file over SSH is the one step of
// the setup that cannot be done from the Gladys web UI. The platform has an
// answer for that: the manifest `containers` field declares — publicly, and
// shown to the user on the install screen — which extra image the integration
// may run, with which limits; the supervisor then creates it on the private
// network of the integration, and the integration drives its lifecycle through
// the host API (`startContainer` / `stopContainer`).
//
// What this module owns:
//   - the admin client key: GENERATED here, stored in the integration's own
//     config, never typed nor read by the user (the manifest is public, so a
//     secret can only travel through the runtime `env` of startContainer);
//   - the lifecycle calls themselves.
//
// The gRPC session (provisioning, messaging, invitations) stays in daemon.js:
// this module only makes sure something is listening at the other end.
// -----------------------------------------------------------------------------

import { randomBytes } from 'node:crypto';
import { chmod, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'olvid-container' });

// Name declared in the manifest `containers` — it is also the DNS alias of the
// container on the private network of the integration.
export const DAEMON_CONTAINER_NAME = 'olvid-daemon';

// Where the integration reaches the managed daemon. The manifest declares NO
// published port: the gRPC API (which the admin key fully controls) is not
// exposed on the LAN, only the integration can talk to it.
export const MANAGED_DAEMON_URL = `http://${DAEMON_CONTAINER_NAME}:50051`;

// The daemon reads its admin keys from the `OLVID_ADMIN_CLIENT_KEY_<NAME>`
// environment variables; the suffix is only a label of the key.
export const ADMIN_KEY_ENV = 'OLVID_ADMIN_CLIENT_KEY_GLADYS';

// Volumes declared for the daemon in the manifest. The supervisor mounts each
// one from a folder derived from the integration data folder, which the
// integration itself may prepare beforehand — the documented pattern for a
// sub-container is "write its files under /data/containers/<name>/…, then
// start it".
export const DAEMON_VOLUMES = ['/daemon/data', '/daemon/backups'];
const CONTAINERS_DATA_DIR = '/data/containers';

/**
 * @description Generate the admin client key of the managed daemon. 32 random
 * bytes, hex-encoded: the same shape as the `openssl rand -hex 32` the Olvid
 * documentation suggests, so a user who later inspects the container sees a
 * familiar value.
 * @returns {string} A fresh admin client key.
 * @example
 * const key = generateAdminClientKey();
 */
export function generateAdminClientKey() {
  return randomBytes(32).toString('hex');
}

/**
 * @description Create the folders the daemon volumes are mounted from, writable
 * by whichever user the supervisor runs the container as.
 *
 * The daemon stores its cryptographic seeds in `<data dir>/security/`, created
 * on the first start: when that `mkdir` fails it logs "Unable to init key
 * management, exiting" and stops, which from the outside looks like a daemon
 * that never comes up. A folder Docker creates on the fly belongs to root,
 * while the container may well run as somebody else — so the integration
 * creates them itself, in its own data folder, and opens the permissions
 * rather than betting on a user id it does not know.
 * @param {object} [options] - Options.
 * @param {string} [options.dataDir] - Root of the sub-container data folders.
 * @returns {Promise<void>} Always resolves: a failure here is not worth
 * blocking a start that may well work anyway.
 * @example
 * await prepareDaemonVolumes();
 */
export async function prepareDaemonVolumes({ dataDir = CONTAINERS_DATA_DIR } = {}) {
  for (const volume of DAEMON_VOLUMES) {
    const path = join(dataDir, DAEMON_CONTAINER_NAME, volume);
    try {
      await mkdir(path, { recursive: true });
      // Explicitly, because the mode of mkdir goes through the umask.
      await chmod(path, 0o777);
    } catch (e) {
      if (e?.code === 'EPERM' || e?.code === 'EACCES') {
        // The folder is already there and belongs to somebody else — a leftover
        // of an earlier start, created by Docker as root. Nothing the
        // integration can do about it from inside its own container.
        logger.warn(
          `The daemon folder ${path} exists and belongs to another user: the daemon may not be able to write in it. Delete it on the Gladys host to let the integration recreate it.`,
        );
      } else {
        logger.warn(`Preparing the daemon folder ${path} failed`, e);
      }
    }
  }
}

/**
 * @description Make sure the managed Olvid daemon is running, and return the
 * settings the gRPC session needs to reach it. Idempotent: the same admin key
 * is passed on every call, so the supervisor keeps the existing container
 * (a different `env` would make it recreate the container — and the Olvid
 * profile lives in a volume, not in the container, so even that stays safe).
 * @param {object} options - Collaborators.
 * @param {object} options.gladys - The Gladys SDK instance.
 * @param {string} [options.adminClientKey] - Key generated on a previous run.
 * @param {Function} options.saveAdminClientKey - `(key) => Promise`, persists a freshly generated key.
 * @returns {Promise<{daemon_url: string, admin_client_key: string}>} Settings of the managed daemon.
 * @example
 * const managed = await startManagedDaemon({ gladys, adminClientKey, saveAdminClientKey });
 */
export async function startManagedDaemon({ gladys, adminClientKey, saveAdminClientKey }) {
  let key = String(adminClientKey ?? '').trim();
  if (!key) {
    logger.info('First run: generating the admin client key of the Olvid daemon');
    key = generateAdminClientKey();
    // Persist BEFORE starting: a container started with a key we forgot would
    // be unreachable forever (the key only exists in its environment).
    await saveAdminClientKey(key);
  }

  await prepareDaemonVolumes();

  logger.info(`Starting the managed Olvid daemon (${DAEMON_CONTAINER_NAME})`);
  await gladys.startContainer(DAEMON_CONTAINER_NAME, { env: { [ADMIN_KEY_ENV]: key } });

  return { daemon_url: MANAGED_DAEMON_URL, admin_client_key: key };
}

/**
 * @description Stop the managed daemon — used when the user switches to their
 * own daemon, so two Olvid clients never run for the same integration. Best
 * effort: a daemon that was never started is not an error.
 * @param {object} gladys - The Gladys SDK instance.
 * @returns {Promise<void>} Always resolves.
 * @example
 * await stopManagedDaemon(gladys);
 */
export async function stopManagedDaemon(gladys) {
  try {
    await gladys.stopContainer(DAEMON_CONTAINER_NAME);
    logger.info('Managed Olvid daemon stopped: an external daemon is configured');
  } catch (e) {
    logger.debug('No managed Olvid daemon to stop', e);
  }
}

// How often the state of the daemon container is checked while the session
// cannot connect: often enough to be useful, rarely enough not to hammer the
// host API on every retry.
const STATE_CHECK_INTERVAL_MS = 30_000;

/**
 * @description Build the watcher that explains a failing connection by the
 * state of the daemon container. "Olvid daemon unreachable" is a dead end when
 * Gladys is the one running the daemon: the answer is whether the container is
 * running at all, and the user cannot see that from the integration logs.
 * @param {object} options - Collaborators.
 * @param {object} options.gladys - The Gladys SDK instance.
 * @param {Function} [options.now] - Clock, injectable for the tests.
 * @param {number} [options.intervalMs] - Minimum delay between two checks.
 * @returns {Function} `() => Promise<object|null>`, a message when the container is not running.
 * @example
 * const watchDaemonContainer = createDaemonContainerWatch({ gladys });
 */
export function createDaemonContainerWatch({
  gladys,
  now = Date.now,
  intervalMs = STATE_CHECK_INTERVAL_MS,
}) {
  let checkedAt = 0;
  let message = null;

  return async function watchDaemonContainer() {
    if (checkedAt && now() - checkedAt < intervalMs) {
      return message;
    }
    checkedAt = now();
    try {
      const containers = await gladys.getContainers();
      const container = (containers ?? []).find((entry) => entry.name === DAEMON_CONTAINER_NAME);
      if (!container) {
        message = null;
        return message;
      }
      if (container.status === 'running') {
        message = null;
        return message;
      }
      // The exit reason is in the container logs, which the integration cannot
      // read: point the user at them rather than paraphrasing a guess.
      logger.error(`The Olvid daemon container is "${container.status}", not running`);
      message = {
        en: `The Olvid daemon container stopped (${container.status}). Check its logs in Gladys.`,
        fr: `Le conteneur du démon Olvid s'est arrêté (${container.status}). Consultez ses logs dans Gladys.`,
      };
      return message;
    } catch (e) {
      logger.debug('Reading the state of the Olvid daemon container failed', e);
      message = null;
      return message;
    }
  };
}

/**
 * @description Turn a container-lifecycle failure into a message for the
 * Configuration screen. The two cases a user can act on are a Gladys too old
 * to run sub-containers and an image that could not be pulled.
 * @param {Error} error - Error thrown by the host API.
 * @returns {{en: string, fr: string}} Multi-language status message.
 * @example
 * await gladys.setConnectionStatus(false, describeContainerError(e));
 */
export function describeContainerError(error) {
  const reason = error?.message ?? 'unknown error';
  if (error?.status === 404) {
    return {
      en: `The Olvid daemon container is unknown to this Gladys (${reason}). Update Gladys, or switch the daemon to "an existing daemon of mine".`,
      fr: `Le conteneur du démon Olvid est inconnu de ce Gladys (${reason}). Mettez Gladys à jour, ou basculez le démon sur « un démon existant à moi ».`,
    };
  }
  return {
    en: `Starting the Olvid daemon failed: ${reason}`,
    fr: `Le démarrage du démon Olvid a échoué : ${reason}`,
  };
}
