// -----------------------------------------------------------------------------
// Routing of the messages exchanged with Gladys.
//
// Two directions, two rules:
//
//   - OLVID -> GLADYS: a contact who linked their account speaks with the
//     authority of that Gladys user, so an unknown contact must NOT reach the
//     brain. `publishMessage` enforces it server-side (404 on an unlinked
//     contact); this module turns that 404 into the linking conversation:
//     the user pastes the code shown by the Gladys UI, we relay it with
//     `linkContact`, and from then on they talk to their home.
//
//   - GLADYS -> OLVID: `onSendMessage` hands us the contact resolved by
//     Gladys and the message to deliver — a reply of the brain, or a
//     notification sent to that user.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';

import { channelText } from './i18n.js';
import { shortenContactKey } from './olvid/identifiers.js';
import { truncateIncoming } from './text.js';

const logger = createLogger({ name: 'messaging' });

/**
 * @description Tell whether a message looks like a Gladys linking code rather
 * than a sentence: short, no space, letters and digits only. A false positive
 * costs nothing (the code is simply refused and the message is then published),
 * it only decides which call is tried first.
 * @param {string} text - Trimmed body of the Olvid message.
 * @returns {boolean} True when the text may be a linking code.
 * @example
 * looksLikeLinkCode('AB23CD45'); // true
 */
export function looksLikeLinkCode(text) {
  return /^[a-z0-9-]{4,16}$/i.test(text ?? '');
}

/**
 * @description Route a message received in Olvid: publish it to the brain when
 * the contact is linked, run the linking flow when they are not.
 * @param {object} deps - Collaborators.
 * @param {object} deps.gladys - The Gladys SDK instance.
 * @param {object} deps.daemon - The Olvid daemon session (`sendMessage`).
 * @param {Map<string, string>} deps.languages - Contact id -> language of the linked user.
 * @param {object} incoming - The message, as normalized by the daemon module.
 * @returns {Promise<void>} Resolves once the message has been handled.
 * @example
 * await handleIncomingMessage({ gladys, daemon, languages }, incoming);
 */
export async function handleIncomingMessage(
  { gladys, daemon, languages },
  { contactKey, contactName, text, attachmentsCount, receivedAt },
) {
  const body = (text ?? '').trim();
  const shortKey = shortenContactKey(contactKey);

  if (body.length === 0) {
    logger.info(`Ignoring an empty message from ${shortKey}`);
    return;
  }

  const language = languages.get(contactKey) ?? null;
  const reply = (key, params) =>
    daemon.sendMessage(contactKey, { text: channelText(key, language, params) });

  // A linking code is short and wordless. When the message looks like one, try
  // the linking first — a linked user typing "ok" is not held back, since an
  // invalid code falls through to the brain right after.
  const mayBeCode = looksLikeLinkCode(body);
  if (mayBeCode) {
    const linked = await tryLink({ gladys, languages }, { contactKey, contactName, body });
    if (linked) {
      logger.info(`Contact ${shortKey} linked to the Gladys user ${linked.first_name}`);
      await daemon.sendMessage(contactKey, {
        text: channelText('link_success', linked.language, { firstName: linked.first_name }),
      });
      return;
    }
  }

  const published = await tryPublish(
    { gladys, languages },
    { contactKey, body, receivedAt, attachmentsCount, reply },
  );
  if (published) {
    return;
  }

  // Not linked (and no valid code): explain how to link.
  logger.info(`Message from the unlinked contact ${shortKey}, sending the linking instructions`);
  await reply(mayBeCode ? 'link_failed' : 'not_linked');
}

async function tryPublish(
  { gladys, languages },
  { contactKey, body, receivedAt, attachmentsCount, reply },
) {
  try {
    await gladys.publishMessage(contactKey, truncateIncoming(body), { createdAt: receivedAt });
    if (attachmentsCount > 0) {
      // The brain only reads text: say so rather than dropping it silently.
      await reply('attachment_ignored');
    }
    return true;
  } catch (e) {
    if (e.status === 404) {
      // Unknown contact: not linked (or unlinked since our last refresh).
      languages.delete(contactKey);
      return false;
    }
    logger.error(`Publishing a message to Gladys failed: ${e.message}`);
    await reply('send_failed');
    // Handled: reporting twice would spam the discussion.
    return true;
  }
}

async function tryLink({ gladys, languages }, { contactKey, contactName, body }) {
  try {
    const user = await gladys.linkContact(body, contactKey, contactName);
    languages.set(contactKey, user.language);
    return user;
  } catch (e) {
    if (e.status === 404) {
      return null;
    }
    logger.error(`Linking a contact failed: ${e.message}`);
    return null;
  }
}

/**
 * @description Refresh the "contact id -> language of the linked user" map,
 * used to answer an unlinked contact in a language they understand and to greet
 * a freshly linked one.
 * @param {object} gladys - The Gladys SDK instance.
 * @param {Map<string, string>} languages - Map to update in place.
 * @returns {Promise<Map<string, string>>} The updated map.
 * @example
 * await refreshContactLanguages(gladys, languages);
 */
export async function refreshContactLanguages(gladys, languages) {
  const contacts = await gladys.getContacts();
  languages.clear();
  for (const contact of contacts) {
    if (contact.user?.language) {
      languages.set(contact.contact_id, contact.user.language);
    }
  }
  logger.info(`${contacts.length} Gladys user(s) linked to an Olvid contact`);
  return languages;
}
