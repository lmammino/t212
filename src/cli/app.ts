import { readFileSync } from 'node:fs'
import { Command } from '@commander-js/extra-typings'
import { createAccountCommand } from '../commands/account.ts'
import { createAuthCommands } from '../commands/auth.ts'
import { createHistoryCommand } from '../commands/history.ts'
import { createExchangesCommand, createInstrumentsCommand } from '../commands/instruments.ts'
import { createOrdersCommand } from '../commands/orders.ts'
import { createPiesCommand } from '../commands/pies.ts'
import { createPositionsCommand } from '../commands/positions.ts'
import type { Runtime } from '../runtime.ts'

type PackageMetadata = {
  version?: unknown
}

function getPackageVersion(): string {
  try {
    const packageJson = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as PackageMetadata

    if (typeof packageJson.version !== 'string' || packageJson.version.length === 0) {
      return '0.0.0'
    }

    return packageJson.version
  } catch {
    return '0.0.0'
  }
}

export function createCli(runtime: Runtime): Command {
  const program = new Command()

  program
    .name('t212')
    .description('Unofficial Trading 212 CLI for humans and AI agents.')
    .version(getPackageVersion())
    .showHelpAfterError()
    .option(
      '--environment <environment>',
      'Trading 212 environment: demo or live. Defaults to live.',
    )
    .option('--read-only', 'Block all write actions before any network request.')
    .option(
      '--output <format>',
      'Output format: json (indented), json-compact (one line), ndjson (one JSON value per line; arrays print one element per line), or pretty (human-readable). Defaults to json.',
    )
    .option(
      '--max-retries <n>',
      'Retries for rate-limited (HTTP 429) read requests; 0 disables. Writes are never retried. Defaults to 3 (env: T212_MAX_RETRIES).',
    )
    .option(
      '--rate-limit-info',
      'Write x-ratelimit-* quota details to stderr after each API response (env: T212_RATE_LIMIT_INFO).',
    )

  // Output routing and exit/error handling are applied to the whole tree by `runCli`.
  for (const command of createAuthCommands(runtime)) {
    program.addCommand(command)
  }

  program.addCommand(createAccountCommand(runtime))
  program.addCommand(createInstrumentsCommand(runtime))
  program.addCommand(createExchangesCommand(runtime))
  program.addCommand(createPositionsCommand(runtime))
  program.addCommand(createOrdersCommand(runtime))
  program.addCommand(createHistoryCommand(runtime))
  program.addCommand(createPiesCommand(runtime))

  return program
}
