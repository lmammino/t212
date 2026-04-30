# Agent Guide

This repository contains `t212-cli`, an unofficial Trading 212 CLI for humans and AI
agents. The npm package exposes both `t212` and `t212-cli` binaries.
Treat all live Trading 212 write actions as high-risk: live orders and cancellations can
affect real money.

## Project Invariants

- Runtime target is Node.js 24 or newer.
- Package manager is pnpm.
- Module system is ESM only: no CommonJS, no `require`, no `__dirname`.
- TypeScript is strict and must remain directly runnable by Node.js type stripping.
- Use only erasable TypeScript syntax. Do not add `enum`, namespaces, decorators,
  parameter properties, or other syntax that requires TypeScript emit transforms.
- Formatting and linting are handled by Biome.
- Style is spaces, single quotes, no semicolons.
- License is MIT.
- JSON is the default CLI output because AI agents should be able to parse command results.

## Important Commands

Use these commands from the repo root:

```sh
pnpm install
pnpm generate:types
pnpm clean
pnpm build
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm run ci
pnpm audit --audit-level moderate
node src/cli.ts --help
```

Do not run `pnpm ci`; pnpm currently treats `ci` as its own unimplemented command. Use
`pnpm run ci`.

Use `pnpm format` only when intentionally applying formatting changes.

## Source Layout

- `src/cli.ts`: TypeScript entrypoint, intended to run directly with Node.js 24 in development.
- `dist/`: generated JavaScript for npm publishing. Do not edit manually.
- `src/cli/app.ts`: Commander command tree and global options.
- `src/cli/run.ts`: top-level parse/error boundary.
- `src/commands/`: command groups and request/payload mapping.
- `src/auth/`: credential resolution, Basic auth header creation, and keyring adapter.
- `src/config/`: global runtime config parsing.
- `src/http/`: typed Trading 212 OpenAPI client wrapper.
- `src/output/`: JSON/pretty output helpers.
- `src/safety/`: write-action safety guard.
- `src/generated/trading212.ts`: generated OpenAPI types. Do not edit manually.
- `openapi/trading212.yaml`: vendored Trading 212 OpenAPI spec.
- `test/`: Vitest tests using mocked fetch and mocked credential storage.

## OpenAPI Types

When `openapi/trading212.yaml` changes, run:

```sh
pnpm generate:types
```

Do not hand-edit `src/generated/trading212.ts`. If generated output ever violates
`erasableSyntaxOnly`, fix the generator options or add a deterministic post-generation
step rather than weakening the TypeScript constraints.

## Publishing Artifact

Do not publish TypeScript-only artifacts for this CLI. Node supports type stripping for
local files, but refuses TypeScript under `node_modules`. npm publishes should include
compiled JavaScript from `dist/`.

This is a bin-only CLI with no public import API, so declaration files are intentionally
not emitted. If a public programmatic API is added later, revisit declaration generation
and ensure emitted declarations do not reference unpublished `.ts` specifiers.

Run `pnpm build` before package dry-runs. `npm publish` and `npm pack --dry-run` also run
the `prepack` script, which regenerates OpenAPI types and rebuilds `dist/`.

## Authentication

The CLI uses the current Trading 212 Basic auth model from the OpenAPI spec:

- `T212_API_KEY`
- `T212_API_SECRET`

The authorization header is:

```text
Authorization: Basic base64(apiKey:apiSecret)
```

Credential precedence is:

1. Complete environment credentials.
2. OS credential store credentials.
3. Error.

Partial environment credentials must fail explicitly. Do not silently fall back to keyring
when only one of `T212_API_KEY` or `T212_API_SECRET` is set.

Stored credentials use `@napi-rs/keyring` behind the internal `SecretStore` interface.
Do not import keyring directly outside the keyring adapter. Tests must mock
`SecretStore`; they must not access the real OS credential store.

Never print API keys, API secrets, Basic auth tokens, or raw credential-store errors that
could include sensitive material.

## Safety Rules

The global read-only mode is controlled by:

- `--read-only`
- `T212_READ_ONLY=true`

Read-only mode must block all write actions before credential resolution and before any
network request.

Write actions must also require explicit confirmation:

- `--yes` allows non-interactive execution.
- Without `--yes`, prompt only when `stdin.isTTY === true`.
- Without `--yes` in a non-interactive shell, fail before credential resolution and before
  network I/O.

Known write actions include:

- Placing market, limit, stop, and stop-limit orders.
- Canceling pending orders.
- Requesting CSV history exports.
- Creating, updating, duplicating, or deleting deprecated pies.

When adding new endpoints, classify them as read or write before implementing the command.
If the endpoint is not a safe GET, treat it as a write action.

## CLI Design Rules

- Commands should be explicit and nested by domain.
- Every command and option should have useful `--help` text.
- Prefer named flags over positional arguments except for stable resource IDs.
- Prefer deterministic JSON objects/arrays over prose output.
- `--output pretty` is for humans; do not make it the default.
- Use `--environment demo|live`, defaulting to live unless product requirements change.
- README examples should prefer demo for first-time testing.
- Deprecated Trading 212 pie endpoints should remain clearly marked deprecated in help text.

## Testing Rules

Tests must not call Trading 212.
Tests must not call the real OS keyring.

Use mocked `fetch` and the in-memory `SecretStore` test helper. Cover these behaviors when
changing related code:

- Global help and command help.
- Auth precedence and partial-env failure.
- Basic auth header construction.
- Read-only guard before network I/O.
- `--yes` enforcement before credential resolution.
- Request URL, method, query, and JSON body mapping.
- API error formatting and exit codes.
- JSON output shape.

## CI And Hooks

GitHub Actions runs `pnpm run ci` on push and pull requests. A separate scheduled workflow
runs `pnpm audit --audit-level moderate`.

Lefthook pre-commit runs lint, format check, typecheck, and tests. If lefthook install
scripts were blocked by pnpm, the hooks may need to be installed manually by the user, but
the repo config should still remain correct.

Publishing is configured in `.github/workflows/release-please.yml` with release-please and
npm Trusted Publishing via GitHub Actions OIDC. Use `PUBLISHING.md` as the operational
source of truth. Do not add long-lived npm publish tokens to GitHub secrets for this
project. The npm publish job uses the GitHub Environment named `npm`; npm Trusted
Publishing must be configured with the same environment name.

release-please only opens release PRs for user-facing Conventional Commits such as `fix:`,
`feat:`, or breaking changes. Internal-only commits such as `chore:` do not create release
PRs by default. While this package is `0.x.y`, release-please is configured so `feat:`
bumps patch and breaking changes bump minor.

## Dependency Guidelines

When adding dependencies:

- Prefer actively maintained packages with ESM and TypeScript support.
- Check current docs and package metadata before choosing APIs.
- Keep runtime dependencies minimal.
- Avoid dependencies that force a transpilation step for app source.
- Hide native integrations behind small internal interfaces so they can be swapped.

## Error Handling

Use `CliError` for expected user-facing errors and set an appropriate exit code:

- `2`: invalid input or missing credentials/config.
- `3`: safety refusal such as read-only violation or missing `--yes`.
- `4`: auth/permission API failures.
- `5`: not-found API failures.
- `1`: generic failure.

Unexpected errors should still be caught at the CLI boundary and printed to stderr.

## Documentation Requirements

Keep `README.md` aligned with CLI behavior. The README must continue to clearly state:

- This is an unofficial Trading 212 client.
- Users act at their own risk.
- Live trading can lose real money.
- Users should prefer read-only API keys where possible.
- Users should use `--read-only` or `T212_READ_ONLY=true` for extra safety.
