// -----------------------------------------------------------------------------
// Text shaping, both ways.
//
// Gladys caps an incoming message at 4096 characters (publishMessage rejects
// anything longer), and a long answer of the brain reads better as a few
// messages than as one wall of text in a chat app. Both operations are pure
// functions, kept here so they can be unit tested without a daemon.
// -----------------------------------------------------------------------------

// Hard limit of gladys.publishMessage().
export const MAX_INCOMING_LENGTH = 4096;
// Size of an outgoing chunk. Comfortably under the limit of a chat bubble.
export const MAX_OUTGOING_LENGTH = 3500;

/**
 * Truncate a message received in Olvid to what Gladys accepts.
 * @param {string} text - Body of the Olvid message.
 * @param {number} [maxLength] - Maximum number of characters.
 * @returns {string} The text, shortened with an ellipsis when needed.
 * @example
 * truncateIncoming('a'.repeat(5000)).length; // 4096
 */
export function truncateIncoming(text, maxLength = MAX_INCOMING_LENGTH) {
  const value = typeof text === 'string' ? text : '';
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 1)}…`;
}

/**
 * Split an outgoing message into chunks small enough for a chat message,
 * cutting on a line break or a space rather than mid-word when possible.
 * @param {string} text - Text to send in the Olvid discussion.
 * @param {number} [maxLength] - Maximum size of a chunk.
 * @returns {string[]} The chunks, in order; empty when there is nothing to send.
 * @example
 * splitOutgoing('hello'); // ['hello']
 */
export function splitOutgoing(text, maxLength = MAX_OUTGOING_LENGTH) {
  const value = typeof text === 'string' ? text.trim() : '';
  if (value.length === 0) {
    return [];
  }
  const chunks = [];
  let rest = value;
  while (rest.length > maxLength) {
    const window = rest.slice(0, maxLength);
    // Prefer a paragraph break, then a line break, then a space.
    const cut = Math.max(
      window.lastIndexOf('\n\n'),
      window.lastIndexOf('\n'),
      window.lastIndexOf(' '),
    );
    const splitAt = cut > maxLength / 2 ? cut : maxLength;
    chunks.push(rest.slice(0, splitAt).trim());
    rest = rest.slice(splitAt).trim();
  }
  if (rest.length > 0) {
    chunks.push(rest);
  }
  return chunks;
}
