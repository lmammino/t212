# t212-cli 📈

Unofficial Trading 212 CLI for humans and AI agents. Script your portfolio, inspect
positions, check history, and place guarded orders from a clean JSON-first command line.

> [!WARNING]
> This project is not affiliated with, endorsed by, or supported by Trading 212. Use it at
> your own risk. The Trading 212 Public API is beta, and live trading actions can lose real
> money.

> [!CAUTION]
> This CLI is still very experimental. Commands, output shape, and safety behavior may
> change before the project is considered stable. Use it at your own risk, especially with
> live accounts.

## ✨ Highlights

- 🤖 Agent-friendly by default: deterministic JSON output and explicit subcommands.
- 🔐 Secure credential storage with the OS keychain via `@napi-rs/keyring`.
- 🧯 Read-only safety switch for all commands: `--read-only` or `T212_READ_ONLY=true`.
- ✅ Write actions require deliberate confirmation with `--yes`.
- 🧬 Strict TypeScript, ESM, compiled npm artifacts, Biome, Vitest, Lefthook, and CI.
- 🚀 npm publishing ready with GitHub Actions OIDC Trusted Publishing.

## 🧯 Safety First

> [!IMPORTANT]
> Prefer creating a Trading 212 API key that does not allow write actions.

> [!TIP]
> For additional safety, run commands with `--read-only` or set:

```sh
export T212_READ_ONLY=true
```

> [!NOTE]
> Read-only mode blocks all non-GET API actions before credentials are resolved and before
> any network request is made. Write commands also require `--yes`; without it, the CLI
> prompts in an interactive terminal and fails in non-interactive shells.

> [!CAUTION]
> The CLI defaults to the live Trading 212 environment because that is the normal account
> environment. For first-time testing, use `--environment demo`.

## 🧰 Requirements

- Node.js 24 or newer
- pnpm 10 or newer

This project uses strict TypeScript with Node.js type stripping for local development.
Source files avoid non-erasable TypeScript syntax such as enums, namespaces, decorators,
and parameter properties. Published npm packages ship compiled JavaScript, so installed
users do not depend on runtime TypeScript stripping.

## ⚡ Install

```sh
pnpm install
pnpm generate:types
pnpm build
```

Run locally:

```sh
node src/cli.ts --help
```

Once published, install it globally from npm:

```sh
npm install --global t212-cli
```

Or run it without a global install:

```sh
npx t212-cli --help
pnpm dlx t212-cli --help
yarn dlx t212-cli --help
bunx t212-cli --help
```

If linked or installed as a package, use either binary:

```sh
t212 --help
t212-cli --help
```

## 🔐 Authentication

The current Trading 212 API spec uses HTTP Basic auth with an API key and API secret.
The CLI supports two credential sources.

> [!IMPORTANT]
> Never commit API keys, API secrets, or `.env` files. Prefer `t212 login` for local use
> and environment variables only for controlled automation.

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

> [!TIP]
> `t212 login` is generally preferred when using agents. You authenticate once, store the
> credentials in the OS keychain, and then reuse the CLI across multiple agent sessions
> without pasting secrets into prompts or exporting them repeatedly.

> [!NOTE]
> On some Linux systems, the desktop Secret Service backend must be available and unlocked.

## 🧾 Output

JSON is the default output for AI-agent use:

> [!TIP]
> Keep the default JSON output when another tool or agent will parse command results.

```sh
t212 --environment demo positions list
```

For human-readable output:

```sh
t212 --output pretty positions list
```

Available `--output` formats:

| Format         | Shape                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------ |
| `json`         | Default. Indented JSON.                                                                    |
| `json-compact` | The same JSON on a single line.                                                            |
| `ndjson`       | Newline-delimited JSON: arrays print one element per line (nothing for an empty array); any other value prints as one line. |
| `pretty`       | Human-readable, not meant for parsing.                                                     |

```sh
t212 --output ndjson positions list | jq -c 'select(.quantity > 10)'
```

If the reader closes the pipe early (for example `t212 --output ndjson history orders --all | head -5`),
the CLI stops quietly: it makes no further requests, prints nothing to stderr, and exits 0.
Other stdout write errors are still reported and exit non-zero.

### Errors

Errors go to stderr and the process exits non-zero. In JSON mode (the default, i.e. any
`--output` other than `pretty`) stderr contains exactly one line with a JSON error
envelope, so agents can parse failures as reliably as results:

```json
{"error":{"code":"api_error","message":"Trading 212 API request failed with HTTP 404 Not Found","exitCode":5,"details":{"status":404,"statusText":"Not Found","body":{"code":"NotFound"}}}}
```

- `code`: stable, machine-readable error code (see the table below).
- `message`: human-readable description.
- `exitCode`: same value as the process exit code.
- `details`: extra structured data, or `null`. For `api_error` it is
  `{ status, statusText, body }`, where `body` is the parsed Trading 212 error response.

When `--progress` is set, stderr also carries `{"progress":…}` lines. The error envelope is
still exactly one line, the only one with a top-level `error` key.

With `--output pretty`, errors are printed as `Error: <message>` and command-line usage
errors keep the usual human-readable text (with suggestions and help).

| Code                        | Exit code     | Meaning                                                                          |
| --------------------------- | ------------- | -------------------------------------------------------------------------------- |
| `usage_error`               | 2             | Unknown command/option, or a missing or invalid argument/option value.           |
| `invalid_environment`       | 2             | `--environment` / `T212_ENVIRONMENT` is not `demo` or `live`.                    |
| `invalid_output_format`     | 2             | `--output` is not a supported format.                                            |
| `invalid_read_only_env`     | 2             | `T212_READ_ONLY` is not a recognised boolean.                                    |
| `missing_credentials`       | 2             | No credentials in env or the OS credential store.                                |
| `partial_env_credentials`   | 2             | Only one of `T212_API_KEY` / `T212_API_SECRET` is set.                           |
| `empty_credentials`         | 2             | `t212 login` was given an empty API key or secret.                               |
| `prompt_cancelled`          | 2             | A `t212 login` prompt was cancelled (Ctrl+C or input ended).                     |
| `read_only_violation`       | 3             | A write action was attempted in read-only mode.                                  |
| `missing_yes`               | 3             | A write action needs `--yes` in a non-interactive shell.                         |
| `write_not_confirmed`       | 3             | The interactive confirmation was declined or cancelled.                          |
| `api_error`                 | 4, 5, or 1    | Trading 212 returned an error: 4 for 401/403, 5 for 404, 1 otherwise.            |
| `credential_store_error`    | 1             | The OS credential store could not be accessed.                                   |
| `pagination_loop`           | 1             | `--all` pagination received a `nextPagePath` it had already requested.           |
| `conflicting_options`       | 2             | `--next-page-path` was combined with `--cursor`, `--limit`, `--ticker`, or `--time`. |
| `invalid_next_page_path`    | 2 or 1        | 2: `--next-page-path` is not a path on this environment and endpoint. 1: `--all` pagination received such a `nextPagePath` from the API. |
| `pagination_limit_exceeded` | 1             | `--all` pagination hit the safety page limit.                                    |
| `output_write_failed`       | 1             | Writing to stdout failed (other than the reader closing the pipe, which exits 0 quietly). |
| `internal_error`            | 1             | Unexpected failure.                                                              |

`--help`, `--version`, and `t212 help` print to stdout and exit `0`. Running `t212` or a
command group such as `t212 orders` without a subcommand, or asking `help` about an
unknown command (`t212 help bogus`), prints the relevant help to stderr (in every output
mode, with no JSON envelope) and exits `2`.

## 🕹️ Commands

Account, instruments, exchanges, and positions:

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

> [!CAUTION]
> Negative quantities are sell orders. Double-check signs before using any write command.

History:

```sh
t212 history dividends --ticker AAPL_US_EQ --limit 20
t212 history orders --cursor 123 --limit 20
t212 history transactions --time 2026-01-01T00:00:00Z
t212 history exports list
t212 history exports request --from 2026-01-01T00:00:00Z --to 2026-02-01T00:00:00Z --yes
```

Without `--all`, history commands return a single page: the API's `{ items, nextPagePath }`
envelope. Add `--all` to `history dividends`, `history orders`, or `history transactions`
to follow `nextPagePath` until the last page and print every item as one JSON array:

```sh
t212 --environment demo history orders --all
t212 history transactions --time 2026-01-01T00:00:00Z --all
```

`--all` requests 50 items per page unless `--limit` is set, and `--cursor` sets the first
page. History endpoints are rate limited (about 6 requests per minute), so large backfills
take a while: when a response reports no remaining quota, the CLI waits until
`x-ratelimit-reset` before requesting the next page.

With `--output ndjson`, `--all` streams: each page's items are written to stdout, one per
line, as soon as the page arrives. An interrupted or failed run still leaves a valid partial
NDJSON file (the error goes to stderr and the exit code is non-zero). The other formats
collect every page first and print once. Without `--all`, `ndjson` prints the single page
envelope `{ items, nextPagePath }` as one line so the cursor is kept.

Add `--progress` to write one line per fetched page to stderr. In JSON formats it looks
like `{"progress":{"page":3,"items":50,"total":150,"nextPagePath":"/api/v0/..."}}`
(`nextPagePath` is `null` on the last page); in `pretty` mode it is a human-readable line.
Nothing extra is written to stderr unless `--progress` is set.

`--next-page-path <path>` starts from a `nextPagePath` printed by an earlier run, with or
without `--all`. The path must point at the same Trading 212 environment and the same
endpoint, so credentials are never sent elsewhere. It already encodes the query, so it
cannot be combined with the command's `--cursor`, `--limit`, `--ticker`, or `--time` flags.

Long backfill with resume (use `--output ndjson`: the other formats print nothing until the
last page, so resuming an interrupted `json`, `json-compact`, or `pretty` run from a progress
cursor would skip the pages it had already fetched):

```sh
t212 --environment demo --output ndjson history orders --all --progress \
  > orders.ndjson 2> progress.log

# If it was interrupted, continue from the last reported page:
P=$(grep '"progress"' progress.log | tail -1 | jq -r '.progress.nextPagePath // empty')
if [ -n "$P" ]; then
  t212 --environment demo --output ndjson history orders --all --progress \
    --next-page-path "$P" >> orders.ndjson 2>> progress.log
else
  echo 'Nothing to resume: the backfill finished (or no page was fetched yet).'
fi
```

`P` is empty when the last progress line has `"nextPagePath": null` (the backfill already
finished) or when there is no progress line yet (just rerun from the start). The
`grep` skips any error line the failed run wrote to stderr. Each progress line is written
right after that page's items, so a run killed between the two can repeat at most one page
on resume; dedupe by id if that matters.

> [!NOTE]
> Deprecated pies endpoints are available under `t212 pies ...` and are marked deprecated
> in command help. Pie mutations also require `--yes` and respect read-only mode.

## ⚙️ Configuration

Global options:

```sh
t212 --environment demo --read-only --output json account summary
```

Environment variables:

- `T212_API_KEY`: Trading 212 API key
- `T212_API_SECRET`: Trading 212 API secret
- `T212_ENVIRONMENT`: `demo` or `live`
- `T212_READ_ONLY`: `true`, `false`, `1`, `0`, `yes`, `no`, `on`, or `off`

## 🛠️ Development

```sh
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm clean
pnpm build
pnpm run ci
```

Lefthook runs linting, formatting checks, typechecking, and tests on commit.

GitHub Actions runs the same checks on push and pull requests. A separate weekly workflow
runs `pnpm audit --audit-level moderate`.

Publishing is configured through release-please plus GitHub Actions OIDC Trusted
Publishing. See `PUBLISHING.md` for the release and npm setup steps.

> [!IMPORTANT]
> Publishing should happen through GitHub Actions OIDC. Do not add long-lived npm publish
> tokens to GitHub secrets for this project.

## 📜 License

MIT
