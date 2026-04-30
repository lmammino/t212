import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { runCli } from '../src/cli/run.ts'
import { credentialAccounts } from '../src/auth/secret-store.ts'
import {
  createJsonFetch,
  createTestRuntime,
  getFetchUrl,
  getRequestHeader,
  getRequestJsonBody,
} from './helpers.ts'

type PackageMetadata = {
  version?: unknown
}

function getPackageVersion(): string {
  const packageJson = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  ) as PackageMetadata

  if (typeof packageJson.version !== 'string') {
    throw new Error('Expected package.json version to be a string')
  }

  return packageJson.version
}

describe('CLI', () => {
  it('prints useful help including agent-safety flags', async () => {
    const { runtime, stdout } = createTestRuntime()

    await expect(runCli(['node', 't212', '--help'], runtime)).resolves.toBe(0)
    expect(stdout.value).toContain('Unofficial Trading 212 CLI')
    expect(stdout.value).toContain('--read-only')
    expect(stdout.value).toContain('orders')
  })

  it('prints the package version', async () => {
    const { runtime, stdout } = createTestRuntime()

    await expect(runCli(['node', 't212', '--version'], runtime)).resolves.toBe(0)
    expect(stdout.value.trim()).toBe(getPackageVersion())
  })

  it('performs an authenticated account summary request against the selected environment', async () => {
    const fetchSetup = createJsonFetch({ currency: 'GBP', totalValue: 123 })
    const { runtime, stdout } = createTestRuntime({
      env: {
        T212_API_KEY: 'key',
        T212_API_SECRET: 'secret',
      },
      fetch: fetchSetup.fetch,
    })

    await expect(
      runCli(['node', 't212', '--environment', 'demo', 'account', 'summary'], runtime),
    ).resolves.toBe(0)

    expect(fetchSetup.calls).toHaveLength(1)
    const call = fetchSetup.calls[0]
    expect(call).toBeDefined()

    if (call === undefined) {
      throw new Error('Expected one fetch call')
    }

    expect(getFetchUrl(call)).toBe('https://demo.trading212.com/api/v0/equity/account/summary')
    expect(getRequestHeader(call, 'authorization')).toBe('Basic a2V5OnNlY3JldA==')
    expect(JSON.parse(stdout.value)).toEqual({ currency: 'GBP', totalValue: 123 })
  })

  it('blocks order placement in read-only mode before network I/O', async () => {
    const fetchSetup = createJsonFetch({ id: 1 })
    const { runtime, stderr } = createTestRuntime({
      env: {
        T212_API_KEY: 'key',
        T212_API_SECRET: 'secret',
        T212_READ_ONLY: 'true',
      },
      fetch: fetchSetup.fetch,
    })

    await expect(
      runCli(
        [
          'node',
          't212',
          'orders',
          'place',
          'market',
          '--ticker',
          'AAPL_US_EQ',
          '--quantity',
          '1',
          '--yes',
        ],
        runtime,
      ),
    ).resolves.toBe(3)

    expect(fetchSetup.calls).toHaveLength(0)
    expect(stderr.value).toContain('read-only mode is enabled')
  })

  it('requires --yes for non-interactive writes before resolving credentials', async () => {
    const fetchSetup = createJsonFetch({ id: 1 })
    const { runtime, stderr } = createTestRuntime({
      fetch: fetchSetup.fetch,
      isTTY: false,
    })

    await expect(runCli(['node', 't212', 'orders', 'cancel', '123'], runtime)).resolves.toBe(3)

    expect(fetchSetup.calls).toHaveLength(0)
    expect(stderr.value).toContain('without --yes')
  })

  it('places a market order with --yes and keyring credentials', async () => {
    const fetchSetup = createJsonFetch({ id: 99, status: 'NEW' })
    const { runtime, stdout, store } = createTestRuntime({
      fetch: fetchSetup.fetch,
    })
    await store.set(credentialAccounts.apiKey, 'key')
    await store.set(credentialAccounts.apiSecret, 'secret')

    await expect(
      runCli(
        [
          'node',
          't212',
          'orders',
          'place',
          'market',
          '--ticker',
          'AAPL_US_EQ',
          '--quantity',
          '-2',
          '--extended-hours',
          '--yes',
        ],
        runtime,
      ),
    ).resolves.toBe(0)

    expect(fetchSetup.calls).toHaveLength(1)
    const call = fetchSetup.calls[0]
    expect(call).toBeDefined()

    if (call === undefined) {
      throw new Error('Expected one fetch call')
    }

    expect(getFetchUrl(call)).toBe('https://live.trading212.com/api/v0/equity/orders/market')
    await expect(getRequestJsonBody(call)).resolves.toEqual({
      extendedHours: true,
      quantity: -2,
      ticker: 'AAPL_US_EQ',
    })
    expect(JSON.parse(stdout.value)).toEqual({ id: 99, status: 'NEW' })
  })

  it('stores credentials through login without printing secrets', async () => {
    const { runtime, stdout, store } = createTestRuntime({
      prompts: {
        input: async () => 'login-key',
        password: async () => 'login-secret',
      },
    })

    await expect(runCli(['node', 't212', 'login'], runtime)).resolves.toBe(0)

    expect(await store.get(credentialAccounts.apiKey)).toBe('login-key')
    expect(await store.get(credentialAccounts.apiSecret)).toBe('login-secret')
    expect(stdout.value).toContain('"stored": true')
    expect(stdout.value).not.toContain('login-secret')
  })
})
