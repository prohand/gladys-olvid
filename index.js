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
//   3. opens the Olvid session once connected, and keeps it in sync with the
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
import { isConfigured, normalizeConfig, requiresReconnect } from './src/config.js';
import { handleIncomingMessage, refreshContactLanguages } from './src/messaging.js';
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
  onConnectionChange: (connected, message) => gladys.setConnectionStatus(connected, message),
  // The client key the integration minted for itself: stored in the config,
  // outside the manifest config_schema (free internal storage, never rendered).
  saveClientKey: async (clientKey) => {
    config = { ...config, client_key: clientKey };
    await gladys.setConfig({ client_key: clientKey });
  },
});

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
  // Same session, new preferences: push them to the Olvid profile.
  try {
    await daemon.updateSettings(config);
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

async function startOlvidSession() {
  if (!isConfigured(config)) {
    logger.warn('Olvid is not configured yet: fill in the daemon URL and the admin client key');
    await daemon.stop();
    await gladys.setConnectionStatus(false, {
      en: 'Configuration needed: daemon URL and admin client key.',
      fr: 'Configuration requise : URL du démon et clé client admin.',
    });
    return;
  }
  await daemon.start(config);
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
