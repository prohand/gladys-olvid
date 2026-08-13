// -----------------------------------------------------------------------------
// Handlers of the manifest `actions` — the buttons of the Configuration screen.
//
// Each handler resolves a multi-language message `{ en, fr }`, displayed under
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
      };
    },

    pending_invitations: async () => {
      const invitations = await withOlvidErrors(() => daemon.listInvitations());
      if (invitations.length === 0) {
        return {
          en: 'No invitation in progress.',
          fr: 'Aucune invitation en cours.',
        };
      }
      const describe = (invitation, language) => {
        const head = `#${invitation.id} ${invitation.displayName} — ${invitation.status}`;
        if (!invitation.waitsForSas) {
          return head;
        }
        return language === 'fr'
          ? `${head} — code à saisir dans Olvid : ${invitation.sas ?? '—'}`
          : `${head} — code to type in Olvid: ${invitation.sas ?? '—'}`;
      };
      return {
        en: invitations.map((invitation) => describe(invitation, 'en')).join('\n'),
        fr: invitations.map((invitation) => describe(invitation, 'fr')).join('\n'),
      };
    },

    accept_invitations: async () => {
      const accepted = await withOlvidErrors(() => daemon.acceptPendingInvitations());
      if (accepted.length === 0) {
        return {
          en: 'No invitation was waiting for Gladys to accept it.',
          fr: "Aucune invitation n'attendait l'acceptation de Gladys.",
        };
      }
      return {
        en: `Accepted: ${accepted.join(', ')}. Exchange the 4-digit code to finish.`,
        fr: `Acceptée(s) : ${accepted.join(', ')}. Échangez le code à 4 chiffres pour terminer.`,
      };
    },

    validate_sas: async (fields = {}) => {
      const target = await withOlvidErrors(() =>
        daemon.submitSas({ invitationId: fields.invitation_id, sas: fields.sas }),
      );
      return {
        en: `Code accepted for the invitation #${target.id} (${target.displayName}).`,
        fr: `Code accepté pour l'invitation n°${target.id} (${target.displayName}).`,
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
