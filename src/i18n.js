// -----------------------------------------------------------------------------
// Texts of the integration, in the two languages Gladys ships with.
//
// Two audiences, two rendering rules:
//   - the CHANNEL (messages the bot writes in Olvid): a single language, the
//     one of the linked Gladys user when we know it, both languages when we
//     do not (an unlinked contact has no user yet, so no language either);
//   - the CONFIGURATION SCREEN (values returned by a manifest action): a
//     multi-language object `{ en, fr }`, resolved by the Gladys frontend.
// -----------------------------------------------------------------------------

const SUPPORTED_LANGUAGES = ['en', 'fr'];

// Every text is a { en, fr } pair, or a function returning one.
const TEXTS = {
  not_linked: {
    en:
      'Your Olvid account is not linked to Gladys yet. Open Gladys → Integrations → Olvid, ' +
      'click "Link my account", then send me the code you are given.',
    fr:
      "Votre compte Olvid n'est pas encore lié à Gladys. Ouvrez Gladys → Intégrations → Olvid, " +
      'cliquez sur « Lier mon compte », puis envoyez-moi le code affiché.',
  },
  link_success: ({ firstName }) => ({
    en: `Account linked to ${firstName}. You can now talk to your home from here.`,
    fr: `Compte lié à ${firstName}. Vous pouvez désormais parler à votre maison depuis ici.`,
  }),
  link_failed: {
    en: 'This code is invalid or expired. Generate a new one from the Gladys Olvid page.',
    fr: 'Ce code est invalide ou expiré. Générez-en un nouveau depuis la page Olvid de Gladys.',
  },
  send_failed: {
    en: 'Gladys could not process your message, please try again.',
    fr: "Gladys n'a pas pu traiter votre message, merci de réessayer.",
  },
  attachment_ignored: {
    en: 'I can only read text messages for now, the attachment was ignored.',
    fr: "Je ne sais lire que les messages texte pour l'instant, la pièce jointe a été ignorée.",
  },
};

/**
 * Resolve a text for the CHANNEL, in the language of the recipient.
 * An unknown language yields both languages, separated by a blank line: an
 * unlinked contact is not attached to any Gladys user yet.
 * @param {string} key - Key of TEXTS.
 * @param {string|null|undefined} language - Language of the linked user ('fr', 'en'…).
 * @param {object} [params] - Interpolation values of a parameterized text.
 * @returns {string} The message to write in the Olvid discussion.
 * @example
 * channelText('not_linked', 'fr');
 */
export function channelText(key, language, params = {}) {
  const entry = TEXTS[key];
  if (!entry) {
    throw new Error(`Unknown text key: ${key}`);
  }
  const texts = typeof entry === 'function' ? entry(params) : entry;
  const normalized = normalizeLanguage(language);
  if (normalized) {
    return texts[normalized];
  }
  return `${texts.en}\n\n${texts.fr}`;
}

/**
 * Reduce a Gladys user language to one of the languages we translate.
 * @param {string|null|undefined} language - Language of the user, e.g. 'fr' or 'fr-FR'.
 * @returns {string|null} 'en', 'fr', or null when unknown.
 * @example
 * normalizeLanguage('fr-FR'); // 'fr'
 */
export function normalizeLanguage(language) {
  if (typeof language !== 'string') {
    return null;
  }
  const short = language.trim().toLowerCase().slice(0, 2);
  return SUPPORTED_LANGUAGES.includes(short) ? short : null;
}
