# Changelog

All notable changes to this integration are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/), bumped by the Release workflow.

## [Unreleased]

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

[Unreleased]: https://github.com/prohand/gladys-olvid/compare/v1.0.6...HEAD
[1.0.6]: https://github.com/prohand/gladys-olvid/compare/v1.0.5...v1.0.6
[1.0.5]: https://github.com/prohand/gladys-olvid/compare/v1.0.4...v1.0.5
[1.0.4]: https://github.com/prohand/gladys-olvid/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/prohand/gladys-olvid/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/prohand/gladys-olvid/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/prohand/gladys-olvid/releases/tag/v1.0.1
