// -----------------------------------------------------------------------------
// Integration configuration.
//
// The configuration is filled in by the user in Gladys, from the `config_schema`
// declared in `gladys-assistant-integration.json`. The SDK fetches it for you
// (`gladys.getConfig()`) and notifies you of every change through
// `gladys.onConfigUpdated()`.
//
// This module only provides defaults and normalizes the received object, so the
// rest of the code never has to deal with `undefined`.
// -----------------------------------------------------------------------------

// Who runs the Olvid daemon. In `managed` mode — the default, and the whole
// point of declaring the daemon in the manifest `containers` field — Gladys
// starts it, so there is nothing to fill in: no URL, no admin key, no SSH.
// `external` is the escape hatch for someone who already runs a daemon.
export const DAEMON_MODES = {
  MANAGED: 'managed',
  EXTERNAL: 'external',
};

// Defaults: they MUST stay consistent with the `default` values declared in the
// `config_schema` of the manifest (see test/manifest.test.js).
export const DEFAULT_CONFIG = {
  // Who runs the daemon: Gladys (a sub-container) or the user.
  daemon_mode: DAEMON_MODES.MANAGED,
  // gRPC endpoint of the daemon, in `external` mode only: in `managed` mode the
  // address is the DNS alias of the sub-container (see olvid/container.js).
  // http:// -> plaintext, https:// -> TLS.
  daemon_url: '',
  // Admin client key of an external daemon (its OLVID_ADMIN_CLIENT_KEY_* env
  // variable). Secret: no default. The managed daemon generates its own.
  admin_client_key: '',
  // Olvid profile (identity) to drive. 0 = use the first profile of the daemon,
  // and create one if the daemon holds none.
  identity_id: 0,
  // Details of the profile created when the daemon is empty. This is a regular
  // Olvid profile ("particulier"): no Keycloak, no configuration link.
  profile_first_name: 'Gladys',
  profile_last_name: 'Assistant',
  // Accept incoming Olvid invitations automatically. The 4-digit SAS exchange
  // still has to be completed by hand (Olvid never automates mutual trust):
  // see the `validate_sas` action.
  auto_accept_invitations: true,
};

// Keys the integration stores by itself through `gladys.setConfig()`. They are
// NOT part of the manifest config_schema (free internal storage, never rendered
// in the Configuration screen) — which is exactly what a generated secret
// needs: `managed_admin_client_key` is never shown to anyone.
export const INTERNAL_CONFIG_KEYS = ['client_key', 'managed_admin_client_key'];

/**
 * Merge the user config with the defaults.
 * @param {Record<string, unknown>} raw - Config returned by the SDK.
 * @returns {Record<string, unknown>} The normalized configuration.
 */
export function normalizeConfig(raw = {}) {
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    // Force the types: config may arrive as strings from a form.
    daemon_mode:
      raw.daemon_mode === DAEMON_MODES.EXTERNAL ? DAEMON_MODES.EXTERNAL : DAEMON_MODES.MANAGED,
    daemon_url: String(raw.daemon_url ?? DEFAULT_CONFIG.daemon_url).trim(),
    admin_client_key: String(raw.admin_client_key ?? DEFAULT_CONFIG.admin_client_key).trim(),
    identity_id: Number(raw.identity_id ?? DEFAULT_CONFIG.identity_id) || 0,
    profile_first_name:
      String(raw.profile_first_name ?? '').trim() || DEFAULT_CONFIG.profile_first_name,
    profile_last_name:
      String(raw.profile_last_name ?? '').trim() || DEFAULT_CONFIG.profile_last_name,
    // Anything but an explicit false means true.
    auto_accept_invitations: raw.auto_accept_invitations !== false,
    // Internal storage: the identity client key minted by the integration, and
    // the admin key of the daemon Gladys runs itself.
    client_key: String(raw.client_key ?? '').trim(),
    managed_admin_client_key: String(raw.managed_admin_client_key ?? '').trim(),
  };
}

/**
 * Tell whether Gladys runs the Olvid daemon itself.
 * @param {Record<string, unknown>} config - Normalized configuration.
 * @returns {boolean} True when the daemon is a Gladys sub-container.
 * @example
 * if (isManagedDaemon(config)) { await startManagedDaemon({ gladys }); }
 */
export function isManagedDaemon(config) {
  return config.daemon_mode !== DAEMON_MODES.EXTERNAL;
}

/**
 * Tell whether a configuration change requires reconnecting to the daemon.
 * Cosmetic changes (the name of a profile that already exists) do not.
 * @param {Record<string, unknown>} previous - Configuration before the update.
 * @param {Record<string, unknown>} next - Configuration after the update.
 * @returns {boolean} True when the Olvid session has to be rebuilt.
 * @example
 * requiresReconnect(config, normalizeConfig(newConfig));
 */
export function requiresReconnect(previous, next) {
  return ['daemon_mode', 'daemon_url', 'admin_client_key', 'identity_id'].some(
    (key) => previous[key] !== next[key],
  );
}

/**
 * Tell whether the configuration holds the minimum needed to connect. The
 * managed daemon always does: its address is fixed and its key is generated,
 * so a fresh install has nothing to fill in.
 * @param {Record<string, unknown>} config - Normalized configuration.
 * @returns {boolean} True when the session can be opened.
 * @example
 * isConfigured(normalizeConfig(await gladys.getConfig()));
 */
export function isConfigured(config) {
  if (isManagedDaemon(config)) {
    return true;
  }
  return Boolean(config.daemon_url && config.admin_client_key);
}
