# Olvid — external integration for Gladys Assistant

Chat with your home from [Olvid](https://olvid.io), the end-to-end encrypted
messenger, exactly like the Telegram integration does: ask a question, get an
answer from the Gladys brain, and receive your scene notifications in the same
discussion.

Built on the official
[JavaScript integration template](https://github.com/GladysAssistant/integration-template-js)
and the [Gladys integration SDK](https://github.com/GladysAssistant/integration-sdk-js),
it is a **communication channel** (manifest `type: "communication"`,
`messaging.receive: true`) — no devices, no discovery screen: users link their
Olvid account to their Gladys user with a short code, and then speak with that
user's authority.

Olvid is used **in its consumer ("particulier") version**: a regular Olvid
profile, no Olvid Enterprise subscription, no Keycloak directory, no
configuration link. The bot meets you the way any Olvid user does — an
invitation link and a 4-digit code.

## Architecture

Olvid has no cloud bot API (no BotFather): the messages of an Olvid bot go
through a **daemon**, a full Olvid client exposing a gRPC API, run by the user
next to Gladys.

```
Olvid app  ──E2EE──►  olvid/bot-daemon  ──gRPC──►  this integration  ──WS/HTTP──►  Gladys
 (phone)              (your machine)               (container)                    (core)
```

The daemon holds the Olvid profile; the integration drives it with the official
[`@olvid/bot-node`](https://www.npmjs.com/package/@olvid/bot-node) client. No
extra third party sees a message.

## What it does

| Direction        | Behaviour                                                                                                                     |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Olvid → Gladys   | One-to-one messages are published to the brain (`publishMessage`), with the linking flow (`linkContact`) for unknown contacts |
| Gladys → Olvid   | `onSendMessage` delivers the answer or the notification; long texts are split, images are attached                            |
| Offline messages | Unread messages waiting on the daemon are replayed at startup, keeping their original timestamp                               |
| Provisioning     | The Olvid profile and the integration's own client key are created on first run, from the daemon admin key                    |
| Invitations      | Accepted automatically (except groups); the manual 4-digit SAS exchange is driven from the Configuration screen               |
| Resilience       | Health checks, exponential-backoff reconnection, connection status reported in the Gladys UI                                  |

Group discussions are deliberately ignored: an incoming message carries the
authority of the linked Gladys user, which only makes sense one-to-one.

## Setup

The full walkthrough (daemon `docker-compose.yml`, invitation, account linking,
troubleshooting) is the user documentation Gladys re-hosts:
[`docs/en.md`](./docs/en.md) — [`docs/fr.md`](./docs/fr.md).

The short version:

1. run the Olvid daemon (`olvid/bot-daemon`) on the Gladys Docker network, with
   an `OLVID_ADMIN_CLIENT_KEY_…` of your choosing;
2. in Gladys, install this integration and fill in the daemon URL and that
   admin key;
3. **Show the invitation link**, open it in your Olvid app, then exchange the
   4-digit code (**Invitations in progress** / **Validate an invitation**);
4. click **Link my account** in Gladys and send the code to the bot in Olvid.

## Project structure

```
.
├─ index.js                          # SDK bootstrap + event wiring (no Olvid logic)
├─ src/
│  ├─ olvid/
│  │  ├─ daemon.js                   #   the gRPC session: provisioning, messaging, invitations, reconnection
│  │  ├─ identifiers.js              #   Gladys contact id <-> Olvid cryptographic identifier
│  │  └─ attachments.js              #   base64 image from Gladys -> Olvid attachment
│  ├─ messaging.js                   # routing: publish to the brain, or run the linking flow
│  ├─ actions.js                     # handlers of the Configuration screen buttons
│  ├─ config.js                      # config defaults + normalization
│  ├─ i18n.js                        # texts written in the channel (en/fr)
│  └─ text.js                        # truncating and splitting messages
├─ docs/en.md, docs/fr.md            # user documentation (mandatory, re-hosted by Gladys)
├─ gladys-assistant-integration.json # manifest (name, config schema, actions, image…)
├─ Dockerfile                        # Node 24 Alpine, read-only rootfs ready
└─ .github/workflows/                # CI + UI-driven release (bump, tag, multi-arch build)
```

## Run it locally

```bash
npm install
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="olvid" \
LOG_LEVEL=debug \
npm start
```

## Quality checks

```bash
npm run format:check   # Prettier
npm run lint           # ESLint
npm test               # unit tests, via the built-in `node --test` runner
```

The tests cover the routing decisions (link vs publish, unknown contact,
attachment, truncation) and the daemon session against an in-memory fake Olvid
daemon: provisioning, contact caching, offline replay, message splitting, SAS
validation and connection loss.

Before tagging a release you can run the store validator, which checks the
manifest, the documentation, the cover and the Docker image exactly like the
indexer does:

```bash
npx github:GladysAssistant/integration-store .
```

## Publishing

1. add the GitHub topic `gladys-assistant-integration` to the repository;
2. **Actions → Release → Run workflow**, pick `patch` / `minor` / `major`: the
   workflow bumps `package.json` and the manifest (`version` +
   `docker_image`), pushes the `vX.Y.Z` tag and builds the
   `linux/amd64` + `linux/arm64` image to `ghcr.io`;
3. the decentralized indexer picks up the new version and Gladys offers a
   one-click install.

## License

AGPL-3.0-only. The integration links against `@olvid/bot-node`, published by
Olvid under the AGPL-3.0, so the combined work is distributed under the same
license.
