// -----------------------------------------------------------------------------
// Attachments coming from Gladys.
//
// `onSendMessage` receives `{ text, file }` where `file` is a base64 image —
// either raw base64, or prefixed the way the Gladys camera channel spells it
// ("image/jpg;base64,…", "data:image/png;base64,…"). We normalize both forms
// into the { filename, payload } pair the Olvid daemon expects.
// -----------------------------------------------------------------------------

const MIME_EXTENSIONS = {
  'image/jpg': 'jpg',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

/**
 * Decode the base64 image of an outgoing message into an Olvid attachment.
 * @param {string} file - Base64 image, with or without a mime prefix.
 * @param {string} [baseName] - Name of the file, without extension.
 * @returns {{ filename: string, payload: Uint8Array }|null} The attachment, or null when there is nothing to attach.
 * @example
 * decodeImageAttachment('image/jpg;base64,/9j/4AAQ…'); // { filename: 'gladys.jpg', payload }
 */
export function decodeImageAttachment(file, baseName = 'gladys') {
  if (typeof file !== 'string' || file.trim().length === 0) {
    return null;
  }
  const trimmed = file.trim();
  // "data:image/png;base64,xxx" | "image/jpg;base64,xxx" | "xxx"
  const match = /^(?:data:)?([\w.+-]+\/[\w.+-]+)?;?base64,(.*)$/s.exec(trimmed);
  const mime = match?.[1]?.toLowerCase();
  const base64 = match ? match[2] : trimmed;
  const payload = Buffer.from(base64, 'base64');
  if (payload.byteLength === 0) {
    return null;
  }
  const extension = MIME_EXTENSIONS[mime] ?? 'jpg';
  return { filename: `${baseName}.${extension}`, payload: new Uint8Array(payload) };
}
