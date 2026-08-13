// -----------------------------------------------------------------------------
// Identifiers exchanged with Gladys.
//
// Gladys stores a `contact_id` string per linked user, and that id has to stay
// valid for years. The Olvid daemon exposes two identifiers for a contact:
//
//   - `contact.id` (uint64): a row id, LOCAL to the daemon database. It is
//     reassigned when the daemon is restored from a backup;
//   - the "bytes identifier" (ContactGetBytesIdentifier): the cryptographic
//     identity of the contact, stable for the lifetime of their Olvid profile.
//
// So Gladys sees the bytes identifier (base64url, URL-safe and printable), and
// this module owns the translation to the daemon-local id used by every RPC.
// -----------------------------------------------------------------------------

/**
 * Encode an Olvid bytes identifier into the contact id given to Gladys.
 * @param {Uint8Array} bytesIdentifier - Cryptographic identifier of the contact.
 * @returns {string} The base64url contact id.
 * @example
 * encodeContactKey(await client.contactGetBytesIdentifier({ contactId }));
 */
export function encodeContactKey(bytesIdentifier) {
  return Buffer.from(bytesIdentifier).toString('base64url');
}

/**
 * Shorten a contact id for the logs: the full identifier is long and is, by
 * itself, enough to invite the contact — no need to spread it in log files.
 * @param {string} contactKey - Contact id as given to Gladys.
 * @returns {string} A short, non-reversible-looking prefix.
 * @example
 * shortenContactKey('AAAAB3Nza…'); // 'AAAAB3Nz…'
 */
export function shortenContactKey(contactKey) {
  if (typeof contactKey !== 'string' || contactKey.length <= 8) {
    return String(contactKey);
  }
  return `${contactKey.slice(0, 8)}…`;
}
