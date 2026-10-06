import type { CommandUnknownOpts } from '@commander-js/extra-typings'
import { CommanderError } from 'commander'
import { createCli } from './app.ts'
import { detectOutputFormat, type OutputFormat } from '../config/runtime-config.ts'
import { CliError, isBrokenPipeError, OutputClosedError, toOutputWriteError } from '../errors.ts'
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
  // `detectOutputFormat` never throws, so it is safe to call outside the error boundary.
  const format = detectOutputFormat(argv)

  try {
    const program = createCli(runtime)
    configureCommandTree(program, runtime, isJsonOutput(format))
    await program.parseAsync([...argv])
    return exitCodeForStdoutFailure(runtime, format) ?? 0
  } catch (error) {
    // The reader closing stdout early (e.g. `| head`) ends the command quietly with 0.
    // This takes precedence over whatever error the interrupted command then raised.
    const stdoutExitCode = exitCodeForStdoutFailure(runtime, format)

    if (stdoutExitCode !== undefined) {
      return stdoutExitCode
    }

    if (error instanceof OutputClosedError || isBrokenPipeError(error)) {
      return 0
    }

    // `--help`, `--version`, and `help` exit with 0 after printing to stdout. Every
    // non-zero Commander exit goes through `exitOverride` and arrives as a `UsageError`.
    if (error instanceof CommanderError && error.exitCode === 0) {
      return 0
    }

    if (error instanceof UsageError && error.reported) {
      return error.exitCode
    }

    writeError(runtime, format, error)
    return error instanceof CliError ? error.exitCode : 1
  }
}

/**
 * Accounts for stdout errors from writes nobody awaited: EPIPE exits quietly with 0, any
 * other stdout failure is reported as `output_write_failed` and exits 1.
 */
function exitCodeForStdoutFailure(runtime: Runtime, format: OutputFormat): number | undefined {
  const failure = runtime.stdoutFailure?.()

  if (failure === undefined) {
    return undefined
  }

  if (isBrokenPipeError(failure)) {
    return 0
  }

  const error = toOutputWriteError(failure)
  writeError(runtime, format, error)
  return error.exitCode
}

/**
 * Applies output routing and exit handling to every command. `addCommand` does not copy
 * these settings from the parent, so each command in the tree is configured explicitly.
 *
 * In JSON mode Commander's own error messages and help-after-error are suppressed: the
 * error is reported once, as the JSON envelope, by `runCli`. The help shown when a group
 * command is invoked without a subcommand (or `help` is given an unknown command) is still
 * written to stderr in every mode.
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
    if (error.code === 'commander.executeSubCommandAsync') {
      // Mirrors Commander's default exitOverride: fired from a child-process callback,
      // where throwing would only produce an unhandled rejection.
      return
    }

    if (error.exitCode === 0) {
      throw error
    }

    if (error.code === 'commander.help') {
      // A group command was invoked without a subcommand, or `help` was given an unknown
      // command: Commander has already shown help on stderr, so only the exit code is left.
      throw new UsageError('Help shown for a missing or unknown subcommand', { reported: true })
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
