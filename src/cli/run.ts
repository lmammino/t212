import type { CommandUnknownOpts } from '@commander-js/extra-typings'
import { CommanderError } from 'commander'
import { createCli } from './app.ts'
import { detectOutputFormat } from '../config/runtime-config.ts'
import { CliError } from '../errors.ts'
import { createDefaultRuntime, type Runtime } from '../runtime.ts'
import { isJsonOutput, writeError } from '../output/format.ts'

const usageErrorExitCode = 2

/**
 * A Commander usage error (unknown option/command, missing or invalid argument, missing
 * subcommand). In pretty mode Commander has already written its own message to stderr.
 */
class UsageError extends CliError {
  constructor(message: string, details?: unknown) {
    super(message, { code: 'usage_error', details, exitCode: usageErrorExitCode })
    this.name = 'UsageError'
  }
}

export async function runCli(
  argv: readonly string[],
  runtime: Runtime = createDefaultRuntime(),
): Promise<number> {
  // Errors can happen before the runtime config is resolved, so detect the format early.
  const format = detectOutputFormat(argv)
  const program = createCli(runtime)
  configureCommandTree(program, runtime, isJsonOutput(format))

  try {
    await program.parseAsync([...argv])
    return 0
  } catch (error) {
    if (error instanceof CommanderError) {
      // `--help`, `--version`, and `help` exit with 0 after printing to stdout.
      if (error.exitCode === 0) {
        return 0
      }

      // A Commander error that did not go through exitOverride (e.g. InvalidArgumentError
      // thrown from an action) has not been printed yet in either mode.
      const usageError = new UsageError(formatCommanderMessage(error.message))
      writeError(runtime, format, usageError)
      return usageError.exitCode
    }

    if (error instanceof UsageError && !isJsonOutput(format)) {
      return error.exitCode
    }

    writeError(runtime, format, error)
    return error instanceof CliError ? error.exitCode : 1
  }
}

/**
 * Applies output routing and exit handling to every command. `addCommand` does not copy
 * these settings from the parent, so each command in the tree is configured explicitly.
 *
 * In JSON mode Commander's own stderr output (error messages and help-after-error) is
 * suppressed: the error is reported once, as the JSON envelope, by `runCli`.
 */
function configureCommandTree(command: CommandUnknownOpts, runtime: Runtime, jsonMode: boolean) {
  command.configureOutput({
    writeErr: (value) => {
      if (!jsonMode) {
        runtime.stderr.write(value)
      }
    },
    writeOut: (value) => runtime.stdout.write(value),
  })

  command.exitOverride((error) => {
    if (error.exitCode === 0) {
      throw error
    }

    if (error.code === 'commander.help') {
      // Commander shows help on stderr and exits non-zero when a command that only groups
      // subcommands is invoked without a (valid) subcommand.
      throw missingSubcommandError(command)
    }

    throw new UsageError(formatCommanderMessage(error.message))
  })

  for (const subcommand of command.commands) {
    configureCommandTree(subcommand, runtime, jsonMode)
  }
}

function missingSubcommandError(command: CommandUnknownOpts): UsageError {
  const commandPath = getCommandPath(command)
  const subcommands = command.commands.map((subcommand) => subcommand.name())

  return new UsageError(
    `"${commandPath}" requires a subcommand. Available subcommands: ${subcommands.join(', ')}. Run "${commandPath} --help" for usage.`,
    { command: commandPath, subcommands },
  )
}

function getCommandPath(command: CommandUnknownOpts): string {
  const names: string[] = []
  let current: CommandUnknownOpts | null = command

  while (current !== null) {
    names.unshift(current.name())
    current = current.parent
  }

  return names.join(' ')
}

/** Turns `error: unknown command 'x'\n(Did you mean y?)` into a single-line message. */
function formatCommanderMessage(message: string): string {
  return message
    .replace(/^error:\s*/, '')
    .replace(/\s*\n\s*/g, ' ')
    .trim()
}
