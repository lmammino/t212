import { Command } from '@commander-js/extra-typings'
import {
  deleteStoredCredentials,
  getCredentialStatus,
  storeCredentials,
} from '../auth/credentials.ts'
import { credentialService } from '../auth/secret-store.ts'
import { resolveRuntimeConfig } from '../config/runtime-config.ts'
import { CliError } from '../errors.ts'
import { writeResult } from '../output/format.ts'
import type { Runtime } from '../runtime.ts'

export function createAuthCommands(runtime: Runtime): Command[] {
  const login = new Command('login').description(
    'Prompt for Trading 212 API key and secret, then store them in the OS credential store.',
  )

  login.action(async () => {
    const config = resolveRuntimeConfig(login, runtime)
    const apiKey = (await runtime.prompts.input({ message: 'Trading 212 API key' })).trim()
    const apiSecret = (
      await runtime.prompts.password({
        mask: '*',
        message: 'Trading 212 API secret',
      })
    ).trim()

    if (apiKey.length === 0 || apiSecret.length === 0) {
      throw new CliError('API key and API secret must both be provided.', {
        code: 'empty_credentials',
        exitCode: 2,
      })
    }

    await storeCredentials(runtime, { apiKey, apiSecret })
    writeResult(runtime, config.output, {
      service: credentialService,
      stored: true,
    })
  })

  const logout = new Command('logout').description('Delete stored Trading 212 credentials.')
  logout.action(async () => {
    const config = resolveRuntimeConfig(logout, runtime)
    const result = await deleteStoredCredentials(runtime)
    writeResult(runtime, config.output, {
      deleted: result.deletedApiKey || result.deletedApiSecret,
      service: credentialService,
    })
  })

  const auth = new Command('auth').description('Inspect CLI authentication status.')
  const status = new Command('status').description(
    'Show whether env or OS credential store auth is configured without revealing secrets.',
  )

  status.action(async () => {
    const config = resolveRuntimeConfig(status, runtime)
    writeResult(runtime, config.output, await getCredentialStatus(runtime))
  })

  auth.addCommand(status)

  return [login, logout, auth]
}
