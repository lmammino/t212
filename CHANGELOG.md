# Changelog

## [0.2.0](https://github.com/lmammino/t212/compare/v0.1.2...v0.2.0) (2026-10-06)


### ⚠ BREAKING CHANGES

* in JSON output mode (the default) errors are now written to stderr as a single-line JSON envelope `{"error":{"code","message","exitCode","details"}}` instead of `Error: <message>`. Use `--output pretty` to get the previous text. Command-line usage errors (unknown command or option, missing or invalid argument, missing subcommand) now exit with code 2 instead of 1.

### Features

* add --all to history commands to follow nextPagePath ([#9](https://github.com/lmammino/t212/issues/9)) ([a56bd3a](https://github.com/lmammino/t212/commit/a56bd3a9b2109674d69a0b5e91a09dad3c53bd92))
* add history exports download command ([#11](https://github.com/lmammino/t212/issues/11)) ([042b848](https://github.com/lmammino/t212/commit/042b8488d65af0109f39203e7edbd8818ec2af8b)), closes [#8](https://github.com/lmammino/t212/issues/8)
* add ndjson and json-compact output with streaming --all ([#12](https://github.com/lmammino/t212/issues/12)) ([62a1eb9](https://github.com/lmammino/t212/commit/62a1eb97c095062c31abf88dd4966a6e191b72bd)), closes [#6](https://github.com/lmammino/t212/issues/6)
* emit structured JSON errors on stderr ([#14](https://github.com/lmammino/t212/issues/14)) ([75f4656](https://github.com/lmammino/t212/commit/75f46566eb1f7b24b2e77023e7e57ae422f1426a)), closes [#7](https://github.com/lmammino/t212/issues/7)
* retry rate-limited reads and surface x-ratelimit headers ([#13](https://github.com/lmammino/t212/issues/13)) ([63b400a](https://github.com/lmammino/t212/commit/63b400a1bd4e757ca7d76e06aaf19ebad7f1585b)), closes [#5](https://github.com/lmammino/t212/issues/5)

## [0.1.2](https://github.com/lmammino/t212/compare/v0.1.1...v0.1.2) (2026-04-30)


### Bug Fixes

* read CLI version from package metadata ([#2](https://github.com/lmammino/t212/issues/2)) ([7226347](https://github.com/lmammino/t212/commit/7226347bba276ec7c37f9a22e6177126c9c40d13))

## [0.1.1](https://github.com/lmammino/t212/compare/v0.1.0...v0.1.1) (2026-04-30)


### Bug Fixes

* trigger initial release ([c362ea1](https://github.com/lmammino/t212/commit/c362ea13818aa45792bf35fb4769077916fa56e1))
