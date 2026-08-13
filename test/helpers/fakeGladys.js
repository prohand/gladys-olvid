// -----------------------------------------------------------------------------
// Minimal in-memory stand-ins for the two sides of the integration, for unit
// tests: the Gladys host API (publishMessage / linkContact / getContacts) and
// the Olvid session (sendMessage). They record their calls so a test can assert
// what the routing decided, without a Gladys server nor an Olvid daemon.
// -----------------------------------------------------------------------------

/**
 * @description Build an error shaped like a Gladys host API error.
 * @param {number} status - HTTP status of the answer.
 * @param {string} [message] - Error message.
 * @returns {Error} The error, carrying a `status` attribute.
 * @example
 * throw apiError(404, 'contact not linked');
 */
export function apiError(status, message = 'error') {
  const error = new Error(message);
  error.status = status;
  return error;
}

/**
 * @description Build a fake Gladys SDK instance.
 * @param {object} [options] - Behaviour of the fake.
 * @param {Set<string>} [options.linkedContacts] - Contacts publishMessage accepts.
 * @param {Map<string, object>} [options.codes] - Valid linking codes -> Gladys user.
 * @param {Array} [options.contacts] - Answer of getContacts().
 * @returns {object} The fake, with a `calls` array.
 * @example
 * const gladys = createFakeGladys({ linkedContacts: new Set(['abc']) });
 */
export function createFakeGladys({
  linkedContacts = new Set(),
  codes = new Map(),
  contacts = [],
} = {}) {
  const calls = [];
  return {
    calls,
    linkedContacts,

    async publishMessage(contactId, text, options = {}) {
      calls.push({ method: 'publishMessage', contactId, text, options });
      if (!linkedContacts.has(contactId)) {
        throw apiError(404, 'contact not linked');
      }
      return { success: true };
    },

    async linkContact(code, contactId, contactName) {
      calls.push({ method: 'linkContact', code, contactId, contactName });
      const user = codes.get(code);
      if (!user) {
        throw apiError(404, 'invalid code');
      }
      linkedContacts.add(contactId);
      return user;
    },

    async getContacts() {
      calls.push({ method: 'getContacts' });
      return contacts;
    },
  };
}

/**
 * @description Build a fake Olvid session recording what the bot writes.
 * @returns {object} The fake, with a `sent` array.
 * @example
 * const daemon = createFakeDaemon();
 */
export function createFakeDaemon() {
  const sent = [];
  return {
    sent,
    async sendMessage(contactKey, message) {
      sent.push({ contactKey, ...message });
    },
  };
}
