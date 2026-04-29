import { resolveCredentials } from '../auth/credentials.ts'
import { resolveRuntimeConfig, type CommandWithGlobalOptions } from '../config/runtime-config.ts'
import { createTrading212Client, type Trading212Client } from '../http/client.ts'
import type { Runtime } from '../runtime.ts'
import { assertWriteAllowed } from '../safety/write-guard.ts'

export type ApiContext = {
  client: Trading212Client
  runtime: Runtime
  config: ReturnType<typeof resolveRuntimeConfig>
}

export async function createReadContext(
  command: CommandWithGlobalOptions,
  runtime: Runtime,
): Promise<ApiContext> {
  const config = resolveRuntimeConfig(command, runtime)
  const credentials = await resolveCredentials(runtime)
  const client = createTrading212Client(runtime, config, credentials)

  return {
    client,
    config,
    runtime,
  }
}

export async function createWriteContext(
  command: CommandWithGlobalOptions,
  runtime: Runtime,
  options: { action: string; yes: boolean | undefined },
): Promise<ApiContext> {
  const config = resolveRuntimeConfig(command, runtime)

  await assertWriteAllowed({
    action: options.action,
    config,
    runtime,
    yes: options.yes === true,
  })

  const credentials = await resolveCredentials(runtime)
  const client = createTrading212Client(runtime, config, credentials)

  return {
    client,
    config,
    runtime,
  }
}
