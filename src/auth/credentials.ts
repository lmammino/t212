import { Buffer } from 'node:buffer'
import { CliError } from '../errors.ts'
import type { Runtime } from '../runtime.ts'
import { credentialAccounts } from './secret-store.ts'

export type CredentialSource = 'env' | 'keyring'

export type Credentials = {
  apiKey: string
  apiSecret: string
  source: CredentialSource
}

export type CredentialStatus = {
  activeSource: CredentialSource | null
  env: {
    hasApiKey: boolean
    hasApiSecret: boolean
  }
  keyring: {
    hasApiKey: boolean
    hasApiSecret: boolean
  }
}

export async function resolveCredentials(runtime: Runtime): Promise<Credentials> {
  const envApiKey = readEnvSecret(runtime.env.T212_API_KEY)
  const envApiSecret = readEnvSecret(runtime.env.T212_API_SECRET)

  if (envApiKey !== null || envApiSecret !== null) {
    if (envApiKey !== null && envApiSecret !== null) {
      return {
        apiKey: envApiKey,
        apiSecret: envApiSecret,
        source: 'env',
      }
    }

    throw new CliError('Both T212_API_KEY and T212_API_SECRET are required when using env auth', {
      code: 'partial_env_credentials',
      exitCode: 2,
    })
  }

  const [apiKey, apiSecret] = await Promise.all([
    runtime.secretStore.get(credentialAccounts.apiKey),
    runtime.secretStore.get(credentialAccounts.apiSecret),
  ])

  if (apiKey !== null && apiSecret !== null) {
    return {
      apiKey,
      apiSecret,
      source: 'keyring',
    }
  }

  throw new CliError(
    'Missing Trading 212 credentials. Run `t212 login` or set T212_API_KEY and T212_API_SECRET.',
    {
      code: 'missing_credentials',
      exitCode: 2,
    },
  )
}

export async function getCredentialStatus(runtime: Runtime): Promise<CredentialStatus> {
  const envApiKey = readEnvSecret(runtime.env.T212_API_KEY)
  const envApiSecret = readEnvSecret(runtime.env.T212_API_SECRET)
  const [keyringApiKey, keyringApiSecret] = await Promise.all([
    runtime.secretStore.get(credentialAccounts.apiKey),
    runtime.secretStore.get(credentialAccounts.apiSecret),
  ])

  const hasCompleteEnvCredentials = envApiKey !== null && envApiSecret !== null
  const hasCompleteKeyringCredentials = keyringApiKey !== null && keyringApiSecret !== null

  return {
    activeSource: hasCompleteEnvCredentials
      ? 'env'
      : hasCompleteKeyringCredentials
        ? 'keyring'
        : null,
    env: {
      hasApiKey: envApiKey !== null,
      hasApiSecret: envApiSecret !== null,
    },
    keyring: {
      hasApiKey: keyringApiKey !== null,
      hasApiSecret: keyringApiSecret !== null,
    },
  }
}

export async function storeCredentials(runtime: Runtime, credentials: Omit<Credentials, 'source'>) {
  await Promise.all([
    runtime.secretStore.set(credentialAccounts.apiKey, credentials.apiKey),
    runtime.secretStore.set(credentialAccounts.apiSecret, credentials.apiSecret),
  ])
}

export async function deleteStoredCredentials(runtime: Runtime) {
  const [deletedApiKey, deletedApiSecret] = await Promise.all([
    runtime.secretStore.delete(credentialAccounts.apiKey),
    runtime.secretStore.delete(credentialAccounts.apiSecret),
  ])

  return {
    deletedApiKey,
    deletedApiSecret,
  }
}

export function createAuthorizationHeader(credentials: Omit<Credentials, 'source'>): string {
  const token = Buffer.from(`${credentials.apiKey}:${credentials.apiSecret}`, 'utf8').toString(
    'base64',
  )
  return `Basic ${token}`
}

function readEnvSecret(value: string | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed === undefined || trimmed.length === 0 ? null : trimmed
}
