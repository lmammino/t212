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
    .option('--output <format>', 'Output format: json or pretty. Defaults to json.')

  program.configureOutput({
    writeErr: (value) => runtime.stderr.write(value),
    writeOut: (value) => runtime.stdout.write(value),
  })

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
