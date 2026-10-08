# Changelog

All notable changes to this integration are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/), bumped by the Release workflow.

## [Unreleased]

## [1.2.1] - 2026-10-08

### Fixed

- Every call to the Olvid daemon is now bounded (15 s, 60 s for an image): a daemon that
  disappears without closing the connection no longer leaves the session believed alive, a
  notification stuck on its send, or a connection attempt that never retries.
- A reconnection to Gladys no longer restarts a healthy Olvid session; it is only restarted
  when it is down or its daemon settings changed.
- The admin client and the client checking the stored key are stopped once used, instead of
  piling up at every reconnection.
- A contact Olvid does not know refreshes the contact list at most once a minute, instead of
  on every notification addressed to it.

### Security

- An unlinked contact may send 5 messages per 15 minutes; past that, its discussion is ignored
  (no linking attempt, no answer) until the window ends, so linking codes cannot be tried in a
  loop.
- Olvid contact ids are shortened in the logs of outgoing messages too.

### Changed

- Node.js 22 or later is required (`engines`); CI tests Node 22 and 24 and builds the image on
  pull requests.
- The image no longer ships `tsx` and `esbuild` (~12 MB), listed by `@olvid/bot-node` but never
  loaded at runtime.

## [1.2.0] - 2026-10-07

- Maintenance release, no functional change.

## [1.1.0] - 2026-10-06

### Added

- `SECURITY.md`: how to report a vulnerability.
- `CHANGELOG.md`, rebuilt from the release history.
- `CLAUDE.md`: guide for contributors and coding agents (commands, architecture, invariants).

### Changed

- Development dependencies updated to their latest versions (ESLint 10.12, Prettier 3.9.9, globals 17.13).
- Integration SDK upgraded from 0.12 to 0.14, @bufbuild/protobuf to 2.16.

## [1.0.6] - 2026-09-29

### Fixed

- Session races, profile change, emoji split

## [1.0.5] - 2026-09-29

### Added

- Cloud transport tag and Olvid message retention policy

## [1.0.4] - 2026-09-02

### Added

- Keep the messages sent while the daemon is down

### Fixed

- Notice a stopped client at once and restart a down daemon
- Never restart a daemon container that is already running

## [1.0.3] - 2026-08-15

### Fixed

- Drop the assistants category from the store manifest

## [1.0.2] - 2026-08-15

### Changed

- Upgrade SDK to 0.12.0 and declare store catalog categories (Gladys 4.86)

## [1.0.1] - 2026-08-14

First public release.

### Added

- Olvid communication integration for Gladys Assistant
- Let Gladys run the Olvid daemon itself

### Fixed

- Keep the managed daemon settings across a configuration update
- Report the state of the daemon container, and give the JVM what it needs
- Create the daemon volumes writable before starting the container
- Give the daemon a temporary folder it is allowed to execute from

[Unreleased]: https://github.com/prohand/gladys-olvid/compare/v1.2.1...HEAD
[1.2.1]: https://github.com/prohand/gladys-olvid/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/prohand/gladys-olvid/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/prohand/gladys-olvid/compare/v1.0.6...v1.1.0
[1.0.6]: https://github.com/prohand/gladys-olvid/compare/v1.0.5...v1.0.6
[1.0.5]: https://github.com/prohand/gladys-olvid/compare/v1.0.4...v1.0.5
[1.0.4]: https://github.com/prohand/gladys-olvid/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/prohand/gladys-olvid/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/prohand/gladys-olvid/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/prohand/gladys-olvid/releases/tag/v1.0.1
