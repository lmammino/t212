import { describe, expect, it } from 'vitest'
import {
  createAuthorizationHeader,
  getCredentialStatus,
  resolveCredentials,
} from '../src/auth/credentials.ts'
import { credentialAccounts } from '../src/auth/secret-store.ts'
import type { CliError } from '../src/errors.ts'
import { createTestRuntime } from './helpers.ts'

describe('credentials', () => {
  it('uses complete environment credentials before keyring credentials', async () => {
    const { runtime, store } = createTestRuntime({
      env: {
        T212_API_KEY: 'env-key',
        T212_API_SECRET: 'env-secret',
      },
    })
    await store.set(credentialAccounts.apiKey, 'stored-key')
    await store.set(credentialAccounts.apiSecret, 'stored-secret')

    await expect(resolveCredentials(runtime)).resolves.toEqual({
      apiKey: 'env-key',
      apiSecret: 'env-secret',
      source: 'env',
    })
  })

  it('rejects partial environment credentials instead of silently falling back', async () => {
    const { runtime, store } = createTestRuntime({
      env: {
        T212_API_KEY: 'env-key',
      },
    })
    await store.set(credentialAccounts.apiKey, 'stored-key')
    await store.set(credentialAccounts.apiSecret, 'stored-secret')

    await expect(resolveCredentials(runtime)).rejects.toMatchObject({
      code: 'partial_env_credentials',
      exitCode: 2,
    } satisfies Partial<CliError>)
  })

  it('falls back to keyring credentials when env credentials are absent', async () => {
    const { runtime, store } = createTestRuntime()
    await store.set(credentialAccounts.apiKey, 'stored-key')
    await store.set(credentialAccounts.apiSecret, 'stored-secret')

    await expect(resolveCredentials(runtime)).resolves.toEqual({
      apiKey: 'stored-key',
      apiSecret: 'stored-secret',
      source: 'keyring',
    })
  })

  it('reports credential status without exposing secret values', async () => {
    const { runtime, store } = createTestRuntime({
      env: {
        T212_API_KEY: 'env-key',
      },
    })
    await store.set(credentialAccounts.apiKey, 'stored-key')
    await store.set(credentialAccounts.apiSecret, 'stored-secret')

    await expect(getCredentialStatus(runtime)).resolves.toEqual({
      activeSource: 'keyring',
      env: {
        hasApiKey: true,
        hasApiSecret: false,
      },
      keyring: {
        hasApiKey: true,
        hasApiSecret: true,
      },
    })
  })

  it('creates a Basic auth header from key and secret', () => {
    expect(createAuthorizationHeader({ apiKey: 'key', apiSecret: 'secret' })).toBe(
      'Basic a2V5OnNlY3JldA==',
    )
  })
})
