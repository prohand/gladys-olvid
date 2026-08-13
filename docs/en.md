# Olvid for Gladys Assistant

This integration adds [Olvid](https://olvid.io) as a chat channel in Gladys,
exactly like the Telegram integration: ask your home a question from Olvid,
Gladys answers in the discussion, and your scenes can send you notifications
through the same channel — end-to-end encrypted, with no company directory, on
a **personal ("particulier") Olvid profile**.

## How it works

Olvid has no cloud bot API: there is no equivalent of Telegram's BotFather. An
Olvid bot is made of two halves:

- the **Olvid daemon** (`olvid/bot-daemon`): a complete Olvid client embedding
  the cryptographic engine and holding your profile, exposing a gRPC API. You
  run it at home, next to Gladys;
- the **bot**: this integration. It drives the daemon, relays messages to
  Gladys and sends the answers back.

No extra third-party service sees your messages: the daemon is an Olvid client,
just like your phone.

## 1. Start the Olvid daemon

On the machine running Gladys, create an `olvid/` folder with this
`docker-compose.yml`:

```yaml
services:
  olvid-daemon:
    image: olvid/bot-daemon:2.0.1
    container_name: olvid-daemon
    restart: unless-stopped
    environment:
      # Pick a long random value: this is the key you will paste into Gladys.
      # It grants full control over the daemon.
      - OLVID_ADMIN_CLIENT_KEY_GLADYS=replace-me-with-a-random-value
    volumes:
      - ./daemon-data:/daemon/data
    networks:
      - gladys
networks:
  gladys:
    external: true
```

The Docker network must be **the one Gladys uses** (`external: true` above):
that is what lets the integration container reach the daemon by its name,
`olvid-daemon`. If the two containers share no network, publish port 50051 and
use the host IP address instead.

Generate a random key, then start it:

```bash
openssl rand -hex 32          # the value for OLVID_ADMIN_CLIENT_KEY_GLADYS
docker compose up -d olvid-daemon
```

> The daemon stores its profile and messages in `./daemon-data`. Back that
> folder up: it is your Olvid identity.

## 2. Configure the integration in Gladys

Install the Olvid integration in Gladys, then fill in:

| Field             | Value                                                |
| ----------------- | ---------------------------------------------------- |
| Olvid daemon URL  | `http://olvid-daemon:50051`                          |
| Admin client key  | the value of `OLVID_ADMIN_CLIENT_KEY_GLADYS`         |
| Profile number    | `0` (Gladys takes the first profile, or creates one) |
| First / last name | the name shown to your contacts ("Gladys Assistant") |

Save, then click **Test the connection**. Gladys should answer with the daemon
version and the profile name. On the first run, the integration:

1. creates a personal Olvid profile when the daemon is empty;
2. mints its own client key (the admin key is only used for that);
3. enables automatic acceptance of incoming invitations.

## 3. Add Gladys to your Olvid contacts

This is the regular Olvid journey for an individual: an invitation, then a
4-digit code exchanged between the two devices. Olvid never automates that
step — it is what proves you are really talking to your own home.

1. click **Show the invitation link**: Gladys displays an
   `https://invitation.olvid.io/…` link;
2. open that link on the phone where Olvid is installed and send the
   invitation;
3. Gladys accepts it automatically (if you turned that option off, click
   **Accept pending invitations**). Your app then shows a 4-digit code and
   waits for another one;
4. in Gladys, click **Invitations in progress**: the code to type into Olvid is
   displayed there. Copy it into the app;
5. type the code displayed by Olvid into the **Validate an invitation** action
   of Gladys.

Once the exchange completes, "Gladys Assistant" appears in your Olvid contacts.

## 4. Link your Olvid account to your Gladys user

Being a contact is not enough: Gladys has to know **which user** is speaking,
since an incoming message drives the home with that user's rights.

1. in Gladys, on the Olvid integration page, click **Link my account**: a short
   code is displayed (valid for 15 minutes);
2. send that code to Gladys in the Olvid discussion;
3. Gladys answers "Account linked to …". You are done.

Until a contact is linked, Gladys forwards nothing to its brain: it simply
answers with the instructions. You can revoke a link at any time from the same
page.

## Usage

- ask in plain language: "what is the temperature in the living room?", "turn
  on the office light";
- scenes that send a message can pick the Olvid channel;
- images sent by Gladys (a camera snapshot) arrive as an attachment;
- long answers are split into several messages.

**Group** discussions are deliberately ignored: an incoming message speaks with
the authority of the linked user, which only makes sense one-to-one.

## Troubleshooting

| Symptom                                  | Likely cause                                                                             |
| ---------------------------------------- | ---------------------------------------------------------------------------------------- |
| "Olvid daemon unreachable"               | The container is not running, or the two containers share no Docker network.             |
| `unauthenticated` on the connection test | The admin client key does not match the one of the daemon container.                     |
| The invitation stays stuck               | The 4-digit code was not exchanged both ways (the "Invitations" and "Validate" actions). |
| "Your Olvid account is not linked yet"   | The linking code was never sent, or it expired (15 minutes).                             |
| Nothing arrives after a restart          | Messages received while offline are replayed on startup; check the integration logs.     |

The integration logs (`LOG_LEVEL=debug` for details) show every step: profile
provisioning, invitations, incoming messages.
