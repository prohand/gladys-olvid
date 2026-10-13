// -----------------------------------------------------------------------------
// Handlers of the manifest `actions` — the buttons of the Configuration screen.
//
// Each handler resolves a multi-language message `{ en, fr, de, es }`, displayed under
// its button (or throws: the error message is shown instead). They are the
// onboarding path of a "particulier" Olvid profile, which cannot rely on a
// company directory to meet people:
//
//   1. `test_connection`  — is the daemon reachable, which profile do we drive;
//   2. `invitation_link`  — the link the user opens in Olvid to invite Gladys;
//   3. `pending_invitations` — where each invitation stands, and the 4-digit
//      code to type in the Olvid app;
//   4. `validate_sas`     — the code displayed by the Olvid app, typed back
//      into Gladys to complete the mutual trust.
// -----------------------------------------------------------------------------

import { describeOlvidError } from './olvid/daemon.js';

// "code to type in Olvid", per language of the Configuration screen.
const SAS_TO_TYPE = {
  en: 'code to type in Olvid: ',
  fr: 'code à saisir dans Olvid : ',
  de: 'in Olvid einzugebender Code: ',
  es: 'código que debe introducir en Olvid: ',
};

/**
 * @description Build the action handlers, bound to the daemon session.
 * @param {object} deps - Collaborators.
 * @param {object} deps.daemon - The Olvid daemon session.
 * @returns {Record<string, Function>} Handlers, keyed by manifest action key.
 * @example
 * const actions = buildActions({ daemon });
 * gladys.onAction('test_connection', actions.test_connection);
 */
export function buildActions({ daemon }) {
  return {
    test_connection: async () => {
      const report = await withOlvidErrors(() => daemon.describeStatus());
      return {
        en:
          `Daemon ${report.version} reachable. Profile "${report.profile}" (#${report.identityId}), ` +
          `${report.contacts} Olvid contact(s), ${report.pendingInvitations} invitation(s) in progress.`,
        fr:
          `Démon ${report.version} joignable. Profil « ${report.profile} » (n°${report.identityId}), ` +
          `${report.contacts} contact(s) Olvid, ${report.pendingInvitations} invitation(s) en cours.`,
        de:
          `Daemon ${report.version} erreichbar. Profil „${report.profile}“ (Nr. ${report.identityId}), ` +
          `${report.contacts} Olvid-Kontakt(e), ${report.pendingInvitations} laufende Einladung(en).`,
        es:
          `Daemon ${report.version} accesible. Perfil «${report.profile}» (n.º ${report.identityId}), ` +
          `${report.contacts} contacto(s) de Olvid, ${report.pendingInvitations} invitación(es) en curso.`,
      };
    },

    invitation_link: async () => {
      const link = await withOlvidErrors(() => daemon.getInvitationLink());
      return {
        en:
          `Open this link on the phone running Olvid, then invite Gladys: ${link}\n` +
          'Olvid will then show a 4-digit code: type it in the "Validate an invitation" action below.',
        fr:
          `Ouvrez ce lien sur le téléphone où tourne Olvid, puis invitez Gladys : ${link}\n` +
          "Olvid affichera ensuite un code à 4 chiffres : saisissez-le dans l'action « Valider une invitation » ci-dessous.",
        de:
          `Öffnen Sie diesen Link auf dem Telefon, auf dem Olvid läuft, und laden Sie Gladys ein: ${link}\n` +
          'Olvid zeigt dann einen 4-stelligen Code an: Geben Sie ihn unten in der Aktion „Einladung bestätigen“ ein.',
        es:
          `Abra este enlace en el teléfono donde se ejecuta Olvid e invite a Gladys: ${link}\n` +
          'Olvid mostrará entonces un código de 4 cifras: introdúzcalo en la acción «Validar una invitación» de abajo.',
      };
    },

    pending_invitations: async () => {
      const invitations = await withOlvidErrors(() => daemon.listInvitations());
      if (invitations.length === 0) {
        return {
          en: 'No invitation in progress.',
          fr: 'Aucune invitation en cours.',
          de: 'Keine laufende Einladung.',
          es: 'Ninguna invitación en curso.',
        };
      }
      const describe = (invitation, language) => {
        const head = `#${invitation.id} ${invitation.displayName} — ${invitation.status}`;
        if (!invitation.waitsForSas) {
          return head;
        }
        return `${head} — ${SAS_TO_TYPE[language]}${invitation.sas ?? '—'}`;
      };
      return Object.fromEntries(
        Object.keys(SAS_TO_TYPE).map((language) => [
          language,
          invitations.map((invitation) => describe(invitation, language)).join('\n'),
        ]),
      );
    },

    accept_invitations: async () => {
      const accepted = await withOlvidErrors(() => daemon.acceptPendingInvitations());
      if (accepted.length === 0) {
        return {
          en: 'No invitation was waiting for Gladys to accept it.',
          fr: "Aucune invitation n'attendait l'acceptation de Gladys.",
          de: 'Keine Einladung wartete auf die Annahme durch Gladys.',
          es: 'Ninguna invitación esperaba a que Gladys la aceptara.',
        };
      }
      return {
        en: `Accepted: ${accepted.join(', ')}. Exchange the 4-digit code to finish.`,
        fr: `Acceptée(s) : ${accepted.join(', ')}. Échangez le code à 4 chiffres pour terminer.`,
        de: `Angenommen: ${accepted.join(', ')}. Tauschen Sie den 4-stelligen Code aus, um abzuschließen.`,
        es: `Aceptada(s): ${accepted.join(', ')}. Intercambie el código de 4 cifras para terminar.`,
      };
    },

    validate_sas: async (fields = {}) => {
      const target = await withOlvidErrors(() =>
        daemon.submitSas({ invitationId: fields.invitation_id, sas: fields.sas }),
      );
      return {
        en: `Code accepted for the invitation #${target.id} (${target.displayName}).`,
        fr: `Code accepté pour l'invitation n°${target.id} (${target.displayName}).`,
        de: `Code für die Einladung Nr. ${target.id} (${target.displayName}) angenommen.`,
        es: `Código aceptado para la invitación n.º ${target.id} (${target.displayName}).`,
      };
    },
  };
}

// The UI shows what a handler throws: keep gRPC noise out of it.
async function withOlvidErrors(run) {
  try {
    return await run();
  } catch (e) {
    throw new Error(describeOlvidError(e), { cause: e });
  }
}
