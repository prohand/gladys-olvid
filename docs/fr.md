# Olvid pour Gladys Assistant

Cette intégration ajoute [Olvid](https://olvid.io) comme canal de discussion
dans Gladys, exactement comme l'intégration Telegram : vous posez une question
à votre maison depuis Olvid, Gladys répond dans la conversation, et vos scènes
peuvent vous envoyer des notifications par ce même canal — le tout chiffré de
bout en bout, sans annuaire d'entreprise, avec un **profil Olvid particulier**.

## Comment ça marche

Olvid n'a pas d'API bot dans le cloud : il n'existe pas d'équivalent du
« BotFather » de Telegram. Un bot Olvid est constitué de deux moitiés :

- le **démon Olvid** (`olvid/bot-daemon`) : une application Olvid complète, qui
  embarque le moteur cryptographique et héberge votre profil. Elle expose une
  API gRPC ;
- le **bot** : cette intégration. Elle pilote le démon, relaie les messages
  vers Gladys et renvoie les réponses.

**Gladys fait tourner le démon pour vous** : il est déclaré dans le manifeste de
l'intégration, donc le superviseur de Gladys le lance dans son propre conteneur,
sur le réseau privé de l'intégration. Vous n'avez ni fichier `docker-compose` à
écrire, ni ligne de commande à taper, ni clé à recopier.

Vos messages ne transitent par aucun service tiers ajouté : le démon est un
client Olvid comme votre téléphone, et son API gRPC n'est publiée sur aucun
port — seule l'intégration peut lui parler.

## 1. Installer l'intégration

Installez l'intégration Olvid depuis le magasin de Gladys. L'écran
d'installation vous indique ce qu'elle va lancer en plus d'elle-même
(`olvid/bot-daemon`, sa limite mémoire, et le fait qu'aucun port n'est publié) :
c'est le contrat que vous acceptez.

Au premier démarrage, sans rien remplir, l'intégration :

1. génère la clé admin du démon (vous ne la voyez ni ne la saisissez jamais) et
   démarre le conteneur du démon ;
2. crée un profil Olvid particulier, puisque le démon est vide ;
3. se crée sa propre clé client, limitée à ce profil (la clé admin ne sert qu'à
   ça) ;
4. active l'acceptation automatique des invitations reçues.

Le démarrage du démon prend quelques dizaines de secondes la première fois
(téléchargement de l'image comprise) : le statut de l'intégration passe de
« Démarrage du démon Olvid… » à connecté tout seul. Cliquez sur **Tester la
connexion** pour le vérifier : Gladys répond avec la version du démon et le nom
du profil.

Vous pouvez ensuite ajuster, si vous le souhaitez :

| Champ            | Valeur                                               |
| ---------------- | ---------------------------------------------------- |
| Prénom / nom     | le nom affiché à vos contacts (« Gladys Assistant ») |
| Numéro du profil | `0` (Gladys prend le premier profil, ou en crée un)  |

> Votre **identité Olvid** (profil, contacts, messages) vit dans le volume du
> conteneur du démon, géré par Gladys avec les données de l'intégration.
> Désinstaller l'intégration détruit ce profil : vos contacts devront vous
> réinviter. Pensez-y avant de désinstaller, et sauvegardez les données de votre
> Gladys comme d'habitude.

## 2. Ajouter Gladys à vos contacts Olvid

C'est le parcours normal d'un particulier sur Olvid : une invitation, puis un
code à 4 chiffres échangé entre les deux appareils. Olvid n'automatise jamais
cette étape — c'est elle qui garantit que vous parlez bien à votre maison.

1. cliquez sur **Afficher le lien d'invitation** : Gladys affiche un lien
   `https://invitation.olvid.io/…` ;
2. ouvrez ce lien sur le téléphone où est installé Olvid, et envoyez
   l'invitation ;
3. Gladys accepte l'invitation automatiquement (si vous avez désactivé cette
   option, cliquez sur **Accepter les invitations en attente**). Votre
   application affiche alors un code à 4 chiffres et en attend un autre ;
4. dans Gladys, cliquez sur **Invitations en cours** : le code à saisir dans
   Olvid y est affiché. Recopiez-le dans l'application ;
5. saisissez le code affiché par Olvid dans l'action **Valider une invitation**
   de Gladys.

Une fois l'échange terminé, « Gladys Assistant » apparaît dans vos contacts
Olvid.

## 3. Lier votre compte Olvid à votre utilisateur Gladys

Être en contact ne suffit pas : Gladys doit savoir **quel utilisateur** parle,
puisqu'un message reçu commande la maison avec ses droits.

1. dans Gladys, sur la page de l'intégration Olvid, cliquez sur
   **Lier mon compte** : un code court s'affiche (valable 15 minutes) ;
2. envoyez ce code à Gladys dans la discussion Olvid ;
3. Gladys répond « Compte lié à … ». C'est terminé.

Tant qu'un contact n'est pas lié, Gladys ne transmet rien à son cerveau : elle
répond simplement la marche à suivre. Vous pouvez révoquer un lien à tout moment
depuis la même page.

## Utilisation

- posez vos questions en langage naturel : « quelle est la température du
  salon ? », « allume la lumière du bureau » ;
- les scènes qui envoient un message peuvent choisir le canal Olvid ;
- les images envoyées par Gladys (photo de caméra) arrivent en pièce jointe ;
- les réponses longues sont découpées en plusieurs messages.

Les discussions **de groupe** sont volontairement ignorées : un message reçu
parle avec les droits de l'utilisateur lié, ce qui n'a de sens qu'en tête-à-tête.

## Utiliser votre propre démon (avancé)

Si vous faites **déjà** tourner un démon Olvid — parce que vous l'utilisez pour
d'autres bots, ou que vous voulez maîtriser sa version et ses sauvegardes —
passez le champ **Démon Olvid** sur « Mon propre démon », puis renseignez :

| Champ              | Valeur                                       |
| ------------------ | -------------------------------------------- |
| URL du démon Olvid | `http://olvid-daemon:50051`                  |
| Clé client admin   | la valeur de `OLVID_ADMIN_CLIENT_KEY_GLADYS` |

Gladys arrête alors le démon qu'elle gérait, pour ne pas faire tourner deux
clients Olvid en parallèle. Le démon doit être joignable depuis le conteneur de
l'intégration : partagez un réseau Docker (le conteneur est alors joignable par
son nom), ou publiez le port 50051 et utilisez l'adresse IP de la machine.

Un `docker-compose.yml` minimal pour ce cas :

```yaml
services:
  olvid-daemon:
    image: olvid/bot-daemon:2.0.1
    container_name: olvid-daemon
    restart: unless-stopped
    environment:
      # Une valeur longue et aléatoire (openssl rand -hex 32) : c'est la clé
      # que vous collerez dans Gladys. Elle donne un contrôle total sur le démon.
      - OLVID_ADMIN_CLIENT_KEY_GLADYS=changez-moi-par-une-valeur-aleatoire
    volumes:
      - ./daemon-data:/daemon/data
```

> Dans ce mode, l'identité Olvid est dans votre dossier `./daemon-data` : c'est
> à vous de le sauvegarder.

## Dépannage

| Symptôme                                    | Cause probable                                                                                                               |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| « Démarrage du démon Olvid… » qui persiste  | Le téléchargement de l'image est encore en cours, ou il a échoué : regardez les logs de l'intégration.                       |
| « Démon Olvid injoignable »                 | Le démon n'a pas fini de démarrer (l'intégration réessaie toute seule). En mode « mon propre démon » : URL ou réseau Docker. |
| `unauthenticated` au test de connexion      | Mode « mon propre démon » : la clé client admin ne correspond pas à celle du conteneur du démon.                             |
| L'invitation reste bloquée                  | Le code à 4 chiffres n'a pas été échangé des deux côtés (actions « Invitations » et « Valider »).                            |
| « Votre compte Olvid n'est pas encore lié » | Le code de liaison n'a pas été envoyé, ou il a expiré (15 minutes).                                                          |
| Rien n'arrive après un redémarrage          | Les messages reçus hors ligne sont rejoués au démarrage ; vérifiez les logs de l'intégration.                                |

Les logs de l'intégration (`LOG_LEVEL=debug` pour le détail) indiquent chaque
étape : provisionnement du profil, invitations, messages reçus.
