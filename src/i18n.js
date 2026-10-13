// -----------------------------------------------------------------------------
// Texts of the integration, in the languages of the Gladys interface.
//
// Two audiences, two rendering rules:
//   - the CHANNEL (messages the bot writes in Olvid): a single language, the
//     one of the linked Gladys user when we translate it (English for any
//     other), English and French when we do not know it at all (an unlinked
//     contact has no user yet, so no language either; two paragraphs read
//     better in a chat bubble than four);
//   - the CONFIGURATION SCREEN (values returned by a manifest action): a
//     multi-language object `{ en, fr, de, es }`, resolved by the Gladys
//     frontend.
// -----------------------------------------------------------------------------

export const SUPPORTED_LANGUAGES = ['en', 'fr', 'de', 'es'];

// Every text is a { en, fr, de, es } object, or a function returning one.
const TEXTS = {
  not_linked: {
    en:
      'Your Olvid account is not linked to Gladys yet. Open Gladys → Integrations → Olvid, ' +
      'click "Link my account", then send me the code you are given.',
    fr:
      "Votre compte Olvid n'est pas encore lié à Gladys. Ouvrez Gladys → Intégrations → Olvid, " +
      'cliquez sur « Lier mon compte », puis envoyez-moi le code affiché.',
    de:
      'Dein Olvid-Konto ist noch nicht mit Gladys verknüpft. Öffne Gladys → Integrationen → Olvid, ' +
      'klicke auf „Mein Konto verknüpfen“ und sende mir dann den angezeigten Code.',
    es:
      'Su cuenta de Olvid aún no está vinculada a Gladys. Abra Gladys → Integraciones → Olvid, ' +
      'pulse «Vincular mi cuenta» y envíeme el código que se muestra.',
  },
  link_success: ({ firstName }) => ({
    en: `Account linked to ${firstName}. You can now talk to your home from here.`,
    fr: `Compte lié à ${firstName}. Vous pouvez désormais parler à votre maison depuis ici.`,
    de: `Konto mit ${firstName} verknüpft. Du kannst jetzt von hier aus mit deinem Zuhause sprechen.`,
    es: `Cuenta vinculada a ${firstName}. Ya puede hablar con su casa desde aquí.`,
  }),
  link_failed: {
    en: 'This code is invalid or expired. Generate a new one from the Gladys Olvid page.',
    fr: 'Ce code est invalide ou expiré. Générez-en un nouveau depuis la page Olvid de Gladys.',
    de: 'Dieser Code ist ungültig oder abgelaufen. Erzeuge einen neuen auf der Olvid-Seite von Gladys.',
    es: 'Este código no es válido o ha caducado. Genere uno nuevo desde la página de Olvid de Gladys.',
  },
  link_blocked: {
    en:
      'Too many messages without a valid code: I will ignore this discussion for 15 minutes. ' +
      'Then generate a new code from the Gladys Olvid page and send it to me.',
    fr:
      'Trop de messages sans code valide : je vais ignorer cette discussion pendant 15 minutes. ' +
      'Générez ensuite un nouveau code depuis la page Olvid de Gladys et envoyez-le-moi.',
    de:
      'Zu viele Nachrichten ohne gültigen Code: Ich ignoriere diese Unterhaltung 15 Minuten lang. ' +
      'Erzeuge danach einen neuen Code auf der Olvid-Seite von Gladys und sende ihn mir.',
    es:
      'Demasiados mensajes sin un código válido: ignoraré esta conversación durante 15 minutos. ' +
      'Después, genere un código nuevo desde la página de Olvid de Gladys y envíemelo.',
  },
  send_failed: {
    en: 'Gladys could not process your message, please try again.',
    fr: "Gladys n'a pas pu traiter votre message, merci de réessayer.",
    de: 'Gladys konnte deine Nachricht nicht verarbeiten, bitte versuche es erneut.',
    es: 'Gladys no ha podido procesar su mensaje, inténtelo de nuevo.',
  },
  attachment_ignored: {
    en: 'I can only read text messages for now, the attachment was ignored.',
    fr: "Je ne sais lire que les messages texte pour l'instant, la pièce jointe a été ignorée.",
    de: 'Ich kann vorerst nur Textnachrichten lesen, der Anhang wurde ignoriert.',
    es: 'Por ahora solo sé leer mensajes de texto, el archivo adjunto se ha ignorado.',
  },
};

/**
 * Resolve a text for the CHANNEL, in the language of the recipient.
 * A language we do not translate falls back to English. No language at all
 * yields English and French, separated by a blank line: an unlinked contact is
 * not attached to any Gladys user yet.
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
    return texts[normalized] ?? texts.en;
  }
  if (typeof language === 'string' && language.trim() !== '') {
    return texts.en;
  }
  return `${texts.en}\n\n${texts.fr}`;
}

/**
 * Reduce a Gladys user language to one of the languages we translate.
 * @param {string|null|undefined} language - Language of the user, e.g. 'fr' or 'fr-FR'.
 * @returns {string|null} 'en', 'fr', 'de', 'es', or null when unknown.
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
