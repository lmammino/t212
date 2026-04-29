import { CommanderError } from 'commander'
import { createCli } from './app.ts'
import { CliError, toErrorMessage } from '../errors.ts'
import { createDefaultRuntime, type Runtime } from '../runtime.ts'
import { writeError } from '../output/format.ts'

export async function runCli(
  argv: readonly string[],
  runtime: Runtime = createDefaultRuntime(),
): Promise<number> {
  const program = createCli(runtime)
  program.exitOverride()

  try {
    await program.parseAsync([...argv])
    return 0
  } catch (error) {
    if (error instanceof CommanderError) {
      return error.exitCode
    }

    if (error instanceof CliError) {
      writeError(runtime, error.message)
      return error.exitCode
    }

    writeError(runtime, toErrorMessage(error))
    return 1
  }
}
