import { Command } from '@commander-js/extra-typings'
import { createAccountCommand } from '../commands/account.ts'
import { createAuthCommands } from '../commands/auth.ts'
import { createHistoryCommand } from '../commands/history.ts'
import { createExchangesCommand, createInstrumentsCommand } from '../commands/instruments.ts'
import { createOrdersCommand } from '../commands/orders.ts'
import { createPiesCommand } from '../commands/pies.ts'
import { createPositionsCommand } from '../commands/positions.ts'
import type { Runtime } from '../runtime.ts'

export function createCli(runtime: Runtime): Command {
  const program = new Command()

  program
    .name('t212')
    .description('Unofficial Trading 212 CLI for humans and AI agents.')
    .version('0.1.0')
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
