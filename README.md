# t212

Unofficial Trading 212 CLI for humans and AI agents.

This project is not affiliated with, endorsed by, or supported by Trading 212. Use it at
your own risk. The Trading 212 Public API is beta, and live trading actions can lose real
money.

## Safety First

Prefer creating a Trading 212 API key that does not allow write actions. For additional
safety, run commands with `--read-only` or set:

```sh
export T212_READ_ONLY=true
```

Read-only mode blocks all non-GET API actions before credentials are resolved and before
any network request is made. Write commands also require `--yes`; without it, the CLI
prompts in an interactive terminal and fails in non-interactive shells.

The CLI defaults to the live Trading 212 environment because that is the normal account
environment. For first-time testing, use `--environment demo`.

## Requirements

- Node.js 24 or newer
- pnpm 10 or newer

This project uses strict TypeScript with Node.js type stripping. Source files avoid
non-erasable TypeScript syntax such as enums, namespaces, decorators, and parameter
properties.

## Install

```sh
pnpm install
pnpm generate:types
```

Run locally:

```sh
node src/cli.ts --help
```

If linked or installed as a package, use:

```sh
t212 --help
```

## Authentication

The current Trading 212 API spec uses HTTP Basic auth with an API key and API secret.
The CLI supports two credential sources.

Environment variables:

```sh
export T212_API_KEY='your-api-key'
export T212_API_SECRET='your-api-secret'
t212 --environment demo account summary
```

OS credential store:

```sh
t212 login
t212 auth status
t212 logout
```

`login` stores credentials in the current OS credential store via `@napi-rs/keyring`
under service `t212-cli`. Secrets are never printed by `auth status`.

On some Linux systems, the desktop Secret Service backend must be available and unlocked.

## Output

JSON is the default output for AI-agent use:

```sh
t212 --environment demo positions list
```

For human-readable output:

```sh
t212 --output pretty positions list
```

## Commands

```sh
t212 account summary
t212 instruments list
t212 exchanges list
t212 positions list --ticker AAPL_US_EQ
```

Pending orders:

```sh
t212 orders list
t212 orders get 123456
t212 orders cancel 123456 --yes
```

Place orders:

```sh
t212 orders place market --ticker AAPL_US_EQ --quantity 1 --yes
t212 orders place limit --ticker AAPL_US_EQ --quantity 1 --limit-price 100 --time-validity DAY --yes
t212 orders place stop --ticker AAPL_US_EQ --quantity -1 --stop-price 90 --yes
t212 orders place stop-limit --ticker AAPL_US_EQ --quantity -1 --stop-price 90 --limit-price 89 --yes
```

Trading 212 uses positive quantity for buy orders and negative quantity for sell orders.

History:

```sh
t212 history dividends --ticker AAPL_US_EQ --limit 20
t212 history orders --cursor 123 --limit 20
t212 history transactions --time 2026-01-01T00:00:00Z
t212 history exports list
t212 history exports request --from 2026-01-01T00:00:00Z --to 2026-02-01T00:00:00Z --yes
```

Deprecated pies endpoints are available under `t212 pies ...` and are marked deprecated
in command help. Pie mutations also require `--yes` and respect read-only mode.

## Configuration

Global options:

```sh
t212 --environment demo --read-only --output json account summary
```

Environment variables:

- `T212_API_KEY`: Trading 212 API key
- `T212_API_SECRET`: Trading 212 API secret
- `T212_ENVIRONMENT`: `demo` or `live`
- `T212_READ_ONLY`: `true`, `false`, `1`, `0`, `yes`, `no`, `on`, or `off`

## Development

```sh
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm run ci
```

Lefthook runs linting, formatting checks, typechecking, and tests on commit.

GitHub Actions runs the same checks on push and pull requests. A separate weekly workflow
runs `pnpm audit --audit-level moderate`.

Publishing is configured for npm Trusted Publishing through GitHub Actions OIDC. See
`PUBLISHING.md` for the required npm and GitHub setup steps.

## License

MIT
