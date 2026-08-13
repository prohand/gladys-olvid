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
  API gRPC. Vous la faites tourner chez vous, à côté de Gladys ;
- le **bot** : cette intégration. Elle pilote le démon, relaie les messages
  vers Gladys et renvoie les réponses.

Vos messages ne transitent donc par aucun service tiers ajouté : le démon est
un client Olvid comme votre téléphone.

## 1. Démarrer le démon Olvid

Sur la machine qui héberge Gladys, créez un dossier `olvid/` avec ce
`docker-compose.yml` :

```yaml
services:
  olvid-daemon:
    image: olvid/bot-daemon:2.0.1
    container_name: olvid-daemon
    restart: unless-stopped
    environment:
      # Choisissez une valeur longue et aléatoire : c'est la clé que vous
      # collerez dans Gladys. Elle donne un contrôle total sur le démon.
      - OLVID_ADMIN_CLIENT_KEY_GLADYS=changez-moi-par-une-valeur-aleatoire
    volumes:
      - ./daemon-data:/daemon/data
    networks:
      - gladys
networks:
  gladys:
    external: true
```

Le réseau Docker doit être **celui de Gladys** (`external: true` ci-dessus) :
c'est ce qui permet au conteneur de l'intégration de joindre le démon par son
nom, `olvid-daemon`. Si vos deux conteneurs ne partagent pas de réseau, publiez
le port 50051 et utilisez l'adresse IP de la machine à la place.

Générez une clé aléatoire, puis démarrez :

```bash
openssl rand -hex 32          # la valeur à mettre dans OLVID_ADMIN_CLIENT_KEY_GLADYS
docker compose up -d olvid-daemon
```

> Le démon écrit son profil et ses messages dans `./daemon-data`. Sauvegardez ce
> dossier : c'est votre identité Olvid.

## 2. Configurer l'intégration dans Gladys

Dans Gladys, installez l'intégration Olvid, puis renseignez :

| Champ              | Valeur                                               |
| ------------------ | ---------------------------------------------------- |
| URL du démon Olvid | `http://olvid-daemon:50051`                          |
| Clé client admin   | la valeur de `OLVID_ADMIN_CLIENT_KEY_GLADYS`         |
| Numéro du profil   | `0` (Gladys prend le premier profil, ou en crée un)  |
| Prénom / nom       | le nom affiché à vos contacts (« Gladys Assistant ») |

Enregistrez, puis cliquez sur **Tester la connexion**. Gladys doit répondre avec
la version du démon et le nom du profil. Au premier démarrage, l'intégration :

1. crée un profil Olvid particulier si le démon est vide ;
2. se crée sa propre clé client (elle n'utilise la clé admin que pour ça) ;
3. active l'acceptation automatique des invitations reçues.

## 3. Ajouter Gladys à vos contacts Olvid

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

## 4. Lier votre compte Olvid à votre utilisateur Gladys

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

## Dépannage

| Symptôme                                    | Cause probable                                                                                    |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| « Démon Olvid injoignable »                 | Le conteneur n'est pas démarré, ou les deux conteneurs ne partagent pas de réseau Docker.         |
| `unauthenticated` au test de connexion      | La clé client admin ne correspond pas à celle du conteneur du démon.                              |
| L'invitation reste bloquée                  | Le code à 4 chiffres n'a pas été échangé des deux côtés (actions « Invitations » et « Valider »). |
| « Votre compte Olvid n'est pas encore lié » | Le code de liaison n'a pas été envoyé, ou il a expiré (15 minutes).                               |
| Rien n'arrive après un redémarrage          | Les messages reçus hors ligne sont rejoués au démarrage ; vérifiez les logs de l'intégration.     |

Les logs de l'intégration (`LOG_LEVEL=debug` pour le détail) indiquent chaque
étape : provisionnement du profil, invitations, messages reçus.
