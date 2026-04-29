import { CliError } from '../errors.ts'
import type { RuntimeConfig } from '../config/runtime-config.ts'
import type { Runtime } from '../runtime.ts'

export type WriteGuardOptions = {
  action: string
  config: RuntimeConfig
  runtime: Runtime
  yes: boolean
}

export async function assertWriteAllowed(options: WriteGuardOptions): Promise<void> {
  if (options.config.readOnly) {
    throw new CliError(`Refusing to ${options.action} because read-only mode is enabled.`, {
      code: 'read_only_violation',
      exitCode: 3,
    })
  }

  if (options.yes) {
    return
  }

  if (options.runtime.stdin.isTTY === true) {
    const confirmed = await options.runtime.prompts.confirm({
      default: false,
      message: `Confirm ${options.action}?`,
    })

    if (confirmed) {
      return
    }

    throw new CliError(`Refusing to ${options.action} without confirmation.`, {
      code: 'write_not_confirmed',
      exitCode: 3,
    })
  }

  throw new CliError(`Refusing to ${options.action} without --yes in a non-interactive shell.`, {
    code: 'missing_yes',
    exitCode: 3,
  })
}
