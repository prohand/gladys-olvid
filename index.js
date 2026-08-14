// -----------------------------------------------------------------------------
// Entry point of the Olvid integration for Gladys Assistant.
//
// Olvid is a communication channel (manifest `type: "communication"`,
// `messaging.receive: true`): the same contract as the Telegram bot, so users
// link their Olvid account to their Gladys user with a code, then talk to their
// home from the messenger — and Gladys sends its notifications back there.
//
// Role of this file: wire the Gladys SDK to the Olvid session. It holds no
// Olvid logic (that lives in src/olvid/) and no routing logic (src/messaging.js):
//   1. instantiates the SDK (connection, auth, reconnection: handled for you);
//   2. registers the event handlers BEFORE connect();
//   3. starts the Olvid daemon Gladys runs itself (src/olvid/container.js),
//      opens the Olvid session once connected, and keeps both in sync with the
//      configuration.
//
// Environment variables provided by the Gladys supervisor to the container:
//   - GLADYS_HOST_API_URL         (host API URL)
//   - GLADYS_INTEGRATION_TOKEN    (integration-scoped JWT)
//   - GLADYS_INTEGRATION_SELECTOR (integration identifier)
// The SDK reads them automatically: `new GladysIntegration()` is enough.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';

import { buildActions } from './src/actions.js';
import { isConfigured, isManagedDaemon, normalizeConfig, requiresReconnect } from './src/config.js';
import { handleIncomingMessage, refreshContactLanguages } from './src/messaging.js';
import {
  createDaemonContainerWatch,
  describeContainerError,
  startManagedDaemon,
  stopManagedDaemon,
} from './src/olvid/container.js';
import { OlvidDaemon } from './src/olvid/daemon.js';

const gladys = new GladysIntegration();

// Current configuration (hot-reloaded via onConfigUpdated).
let config = normalizeConfig();

// Language of each linked user, keyed by Olvid contact id: an unlinked contact
// has no Gladys user yet, so no language either — those get both languages.
const languages = new Map();

const daemon = new OlvidDaemon({
  // Olvid -> Gladys: the brain answers through onSendMessage below.
  onIncomingMessage: (message) => handleIncomingMessage({ gladys, daemon, languages }, message),
  // Application-level status, shown in the Configuration screen. Distinct from
  // the container state machine: the integration can be RUNNING and still
  // unable to reach the Olvid daemon.
  onConnectionChange: (connected, message) => reportConnectionStatus(connected, message),
  // The client key the integration minted for itself: stored in the config,
  // outside the manifest config_schema (free internal storage, never rendered).
  saveClientKey: (clientKey) => saveInternalConfig({ client_key: clientKey }),
});

/**
 * Persist a value the integration owns (never rendered in the Configuration
 * screen), keeping the in-memory config in sync so a reconnection reuses it
 * without a round trip.
 * @param {Record<string, string>} patch - Internal keys to store.
 * @returns {Promise<void>} Resolves once Gladys stored them.
 */
async function saveInternalConfig(patch) {
  config = { ...config, ...patch };
  await gladys.setConfig(patch);
}

// Address and admin key of the daemon Gladys runs itself, resolved when it is
// started. They are NOT in `config`: the managed daemon has nothing the user
// fills in, so the Configuration screen knows nothing about them.
let managedDaemon = null;

/**
 * The configuration as the Olvid session sees it: the user's values, plus the
 * connection settings of the managed daemon when Gladys is the one running it.
 * @returns {Record<string, unknown>} Configuration of the session.
 */
function sessionConfig() {
  if (isManagedDaemon(config) && managedDaemon) {
    return { ...config, ...managedDaemon };
  }
  return config;
}

const watchDaemonContainer = createDaemonContainerWatch({ gladys });

/**
 * Report the connection status, explaining it by the state of the daemon
 * container when Gladys is the one running it: "daemon unreachable" is a dead
 * end for a user who cannot see that the container itself stopped.
 * @param {boolean} connected - Whether the Olvid session is open.
 * @param {object} [message] - Multi-language reason from the session.
 * @returns {Promise<void>} Resolves once Gladys stored the status.
 */
async function reportConnectionStatus(connected, message) {
  if (connected || !isManagedDaemon(config)) {
    return gladys.setConnectionStatus(connected, message);
  }
  const containerMessage = await watchDaemonContainer();
  return gladys.setConnectionStatus(false, containerMessage ?? message);
}

// --- Gladys -> Olvid: deliver a message in the channel ------------------------
// `contact` is the identity resolved by Gladys ({ id }, our Olvid contact id),
// `message` is `{ text, file }`. Throwing acks the command as failed.
gladys.onSendMessage(async (contact, message) => {
  logger.info(`onSendMessage -> Olvid contact ${contact.id}`);
  await daemon.sendMessage(contact.id, message);
});

// --- Manifest actions: buttons of the Configuration screen --------------------
const actions = buildActions({ daemon });
for (const [key, handler] of Object.entries(actions)) {
  gladys.onAction(key, handler);
}

// --- Configuration updated by the user ----------------------------------------
gladys.onConfigUpdated(async (newConfig) => {
  logger.info('onConfigUpdated -> new configuration received');
  const previous = config;
  config = normalizeConfig(newConfig);
  if (requiresReconnect(previous, config)) {
    await startOlvidSession();
    return;
  }
  // Same session, new preferences: push them to the Olvid profile. The session
  // config, not the raw one — the daemon we manage is not in there, and this
  // handler also fires on the keys the integration stores by itself.
  try {
    await daemon.updateSettings(sessionConfig());
  } catch (e) {
    logger.error('Applying the new configuration to the Olvid profile failed', e);
  }
});

// --- Connection lifecycle ------------------------------------------------------
// The SDK logs the WebSocket lifecycle itself (under the `gladys-sdk` name):
// these handlers only run the integration's own (re)initialization.
gladys.on('connected', async () => {
  try {
    config = normalizeConfig(await gladys.getConfig());
    await refreshContactLanguages(gladys, languages);
    await startOlvidSession();
  } catch (e) {
    logger.error('Post-connection initialization failed', e);
    await gladys
      .setConnectionStatus(false, {
        en: 'Initialization failed, check the integration logs.',
        fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
      })
      .catch(() => {});
  }
});

// The Olvid session is deliberately NOT closed when the Gladys WebSocket drops:
// the SDK reconnects on its own, and tearing down the Olvid client would lose
// the messages received in between (they stay unread on the daemon, but the
// round trip is pointless).
gladys.on('disconnected', () => {
  logger.info('Disconnected from Gladys, keeping the Olvid session open');
});

// Opens the Olvid session, starting the daemon first when Gladys is the one
// running it. In managed mode there is nothing to configure: the address is the
// DNS alias of the sub-container and the admin key is generated on first run —
// the user never opens a terminal.
async function startOlvidSession() {
  if (!isConfigured(config)) {
    logger.warn('External daemon selected but not configured: fill in the URL and the admin key');
    await daemon.stop();
    await gladys.setConnectionStatus(false, {
      en: 'Configuration needed: URL and admin client key of your Olvid daemon.',
      fr: 'Configuration requise : URL et clé client admin de votre démon Olvid.',
    });
    return;
  }

  if (isManagedDaemon(config)) {
    try {
      await gladys.setConnectionStatus(false, {
        en: 'Starting the Olvid daemon…',
        fr: 'Démarrage du démon Olvid…',
      });
      managedDaemon = await startManagedDaemon({
        gladys,
        adminClientKey: config.managed_admin_client_key,
        saveAdminClientKey: (key) => saveInternalConfig({ managed_admin_client_key: key }),
      });
    } catch (e) {
      logger.error('Starting the managed Olvid daemon failed', e);
      managedDaemon = null;
      await daemon.stop();
      await gladys.setConnectionStatus(false, describeContainerError(e)).catch(() => {});
      return;
    }
  } else {
    // The user brought their own daemon: make sure ours is not running too.
    managedDaemon = null;
    await stopManagedDaemon(gladys);
  }

  // The daemon container is up, but its gRPC API needs a few seconds to answer:
  // the session retries on its own with a backoff, no need to poll here.
  await daemon.start(sessionConfig());
}

// --- Graceful shutdown ----------------------------------------------------------
// The SDK disconnects cleanly and exits with code 0 when the supervisor stops
// the container (SIGTERM/SIGINT).
gladys.handleShutdown(async (signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
  await daemon.stop();
});

// --- Startup ---------------------------------------------------------------------
logger.info('Starting the Olvid integration...');
gladys.connect().catch((e) => {
  logger.error('Initial connection failed', e);
  process.exit(1);
});
