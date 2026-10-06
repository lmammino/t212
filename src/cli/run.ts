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
 * subcommand). `reported` is true when Commander has already written it to stderr.
 */
class UsageError extends CliError {
  readonly reported: boolean

  constructor(message: string, options: { reported: boolean }) {
    super(message, { code: 'usage_error', exitCode: usageErrorExitCode })
    this.name = 'UsageError'
    this.reported = options.reported
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
      const usageError = new UsageError(formatCommanderMessage(error.message), {
        reported: false,
      })
      writeError(runtime, format, usageError)
      return usageError.exitCode
    }

    if (error instanceof UsageError && error.reported) {
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
 * In JSON mode Commander's own error messages and help-after-error are suppressed: the
 * error is reported once, as the JSON envelope, by `runCli`. The help shown when a group
 * command is invoked without a subcommand is still written to stderr in every mode.
 */
function configureCommandTree(command: CommandUnknownOpts, runtime: Runtime, jsonMode: boolean) {
  command.configureOutput({
    outputError: (value, write) => {
      if (!jsonMode) {
        write(value)
      }
    },
    writeErr: (value) => runtime.stderr.write(value),
    writeOut: (value) => runtime.stdout.write(value),
  })

  if (jsonMode) {
    command.showHelpAfterError(false)
  }

  command.exitOverride((error) => {
    if (error.exitCode === 0) {
      throw error
    }

    if (error.code === 'commander.help') {
      // A group command was invoked without a (valid) subcommand: Commander has already
      // shown its help on stderr, so only the usage exit code is left to apply.
      throw new UsageError('Missing subcommand', { reported: true })
    }

    throw new UsageError(formatCommanderMessage(error.message), { reported: !jsonMode })
  })

  for (const subcommand of command.commands) {
    configureCommandTree(subcommand, runtime, jsonMode)
  }
}

/** Turns `error: unknown command 'x'\n(Did you mean y?)` into a single-line message. */
function formatCommanderMessage(message: string): string {
  return message
    .replace(/^error:\s*/, '')
    .replace(/\s*\n\s*/g, ' ')
    .trim()
}
