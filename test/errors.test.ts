import { Buffer } from 'node:buffer'
import { describe, expect, it, vi } from 'vitest'
import { KeyringSecretStore } from '../src/auth/keyring-store.ts'
import { runCli } from '../src/cli/run.ts'
import { detectOutputFormat } from '../src/config/runtime-config.ts'
import { CliError } from '../src/errors.ts'
import { isJsonOutput, writeError } from '../src/output/format.ts'
import { createJsonFetch, createTestRuntime } from './helpers.ts'

vi.mock('@napi-rs/keyring', () => ({
  Entry: class {
    getPassword(): never {
      throw new Error('Platform failure for service t212-cli account api-key: raw-keyring-detail')
    }
  },
}))

const credentials = {
  T212_API_KEY: 'super-secret-key',
  T212_API_SECRET: 'super-secret-secret',
}
// base64("super-secret-key:super-secret-secret")
const basicToken = Buffer.from('super-secret-key:super-secret-secret').toString('base64')

/** Asserts stderr is exactly one JSON line and returns the parsed envelope. */
function parseEnvelope(stderr: string): unknown {
  expect(stderr.endsWith('\n')).toBe(true)
  const lines = stderr.slice(0, -1).split('\n')
  expect(lines).toHaveLength(1)
  return JSON.parse(lines[0] ?? '')
}

function expectNoSecrets(value: string): void {
  expect(value).not.toContain('super-secret-key')
  expect(value).not.toContain('super-secret-secret')
  expect(value).not.toContain(basicToken)
  expect(value).not.toMatch(/Basic /)
}

describe('structured errors in JSON mode', () => {
  it('emits a CliError without details as a one-line envelope with null details', async () => {
    const fetchSetup = createJsonFetch({})
    const { runtime, stderr, stdout } = createTestRuntime({ fetch: fetchSetup.fetch })

    await expect(runCli(['node', 't212', 'account', 'summary'], runtime)).resolves.toBe(2)

    expect(fetchSetup.calls).toHaveLength(0)
    expect(stdout.value).toBe('')
    expect(parseEnvelope(stderr.value)).toEqual({
      error: {
        code: 'missing_credentials',
        message:
          'Missing Trading 212 credentials. Run `t212 login` or set T212_API_KEY and T212_API_SECRET.',
        exitCode: 2,
        details: null,
      },
    })
  })

  it('emits CliError details when present', () => {
    const { runtime, stderr } = createTestRuntime()

    writeError(
      runtime,
      'json',
      new CliError('Something specific failed', {
        code: 'custom_failure',
        details: { reason: 'because' },
        exitCode: 3,
      }),
    )

    expect(stderr.value).toBe(
      '{"error":{"code":"custom_failure","message":"Something specific failed","exitCode":3,"details":{"reason":"because"}}}\n',
    )
  })

  it('falls back to null details when details cannot be serialized', () => {
    const { runtime, stderr } = createTestRuntime()
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic

    writeError(runtime, 'json', new CliError('Boom', { code: 'cyclic', details: cyclic }))

    expect(parseEnvelope(stderr.value)).toEqual({
      error: { code: 'cyclic', message: 'Boom', exitCode: 1, details: null },
    })
  })

  it('emits api_error with HTTP status and the parsed API error body', async () => {
    const fetchSetup = createJsonFetch({ code: 'NotFound', message: 'Order not found' }, 404)
    const { runtime, stderr, stdout } = createTestRuntime({
      env: credentials,
      fetch: fetchSetup.fetch,
    })

    await expect(runCli(['node', 't212', 'orders', 'get', '42'], runtime)).resolves.toBe(5)

    expect(stdout.value).toBe('')
    expect(parseEnvelope(stderr.value)).toEqual({
      error: {
        code: 'api_error',
        message: 'Trading 212 API request failed with HTTP 404 Error',
        exitCode: 5,
        details: {
          status: 404,
          statusText: 'Error',
          body: { code: 'NotFound', message: 'Order not found' },
        },
      },
    })
    expectNoSecrets(stderr.value)
  })

  it('maps auth failures to exit code 4 without leaking credentials', async () => {
    const fetchSetup = createJsonFetch({ message: 'Unauthorized' }, 401)
    const { runtime, stderr } = createTestRuntime({ env: credentials, fetch: fetchSetup.fetch })

    await expect(runCli(['node', 't212', 'account', 'summary'], runtime)).resolves.toBe(4)

    expect(parseEnvelope(stderr.value)).toMatchObject({
      error: { code: 'api_error', exitCode: 4, details: { status: 401 } },
    })
    expectNoSecrets(stderr.value)
  })

  it('emits internal_error with exit code 1 for unexpected exceptions', async () => {
    const failingFetch: typeof fetch = async () => {
      throw new TypeError('fetch failed')
    }
    const { runtime, stderr } = createTestRuntime({ env: credentials, fetch: failingFetch })

    await expect(runCli(['node', 't212', 'account', 'summary'], runtime)).resolves.toBe(1)

    expect(parseEnvelope(stderr.value)).toEqual({
      error: { code: 'internal_error', message: 'fetch failed', exitCode: 1, details: null },
    })
  })

  it('emits invalid_environment before config resolution and before network I/O', async () => {
    const fetchSetup = createJsonFetch({})
    const { runtime, stderr } = createTestRuntime({ env: credentials, fetch: fetchSetup.fetch })

    await expect(
      runCli(['node', 't212', '--environment', 'staging', 'account', 'summary'], runtime),
    ).resolves.toBe(2)

    expect(fetchSetup.calls).toHaveLength(0)
    expect(parseEnvelope(stderr.value)).toEqual({
      error: {
        code: 'invalid_environment',
        message: 'Invalid environment "staging". Expected demo or live.',
        exitCode: 2,
        details: null,
      },
    })
  })

  it('emits invalid_output_format as JSON because the format itself is unusable', async () => {
    const { runtime, stderr } = createTestRuntime({ env: credentials })

    await expect(
      runCli(['node', 't212', '--output', 'yaml', 'account', 'summary'], runtime),
    ).resolves.toBe(2)

    expect(parseEnvelope(stderr.value)).toMatchObject({
      error: { code: 'invalid_output_format', exitCode: 2, details: null },
    })
  })

  it('emits credential_store_error without the raw keyring error', async () => {
    const { runtime, stderr } = createTestRuntime()
    runtime.secretStore = new KeyringSecretStore()

    await expect(runCli(['node', 't212', 'account', 'summary'], runtime)).resolves.toBe(1)

    expect(parseEnvelope(stderr.value)).toEqual({
      error: {
        code: 'credential_store_error',
        message: 'Could not access the OS credential store',
        exitCode: 1,
        details: null,
      },
    })
    expect(stderr.value).not.toContain('raw-keyring-detail')
  })
})

describe('usage errors', () => {
  it('reports unknown commands as usage_error with the suggestion and exit code 2', async () => {
    const { runtime, stderr, stdout } = createTestRuntime()

    await expect(runCli(['node', 't212', 'ordrs'], runtime)).resolves.toBe(2)

    expect(stdout.value).toBe('')
    expect(parseEnvelope(stderr.value)).toEqual({
      error: {
        code: 'usage_error',
        message: "unknown command 'ordrs' (Did you mean orders?)",
        exitCode: 2,
        details: null,
      },
    })
  })

  it.each([
    [['node', 't212', '--bogus'], "unknown option '--bogus'"],
    [['node', 't212', 'orders', 'cancel'], "missing required argument 'id'"],
    [['node', 't212', 'orders', 'get', 'abc'], "command-argument value 'abc' is invalid"],
    [
      ['node', 't212', 'orders', 'place', 'limit', '--ticker', 'A', '--quantity', '1'],
      "required option '--limit-price <number>' not specified",
    ],
    [['node', 't212', '--output'], "option '--output <format>' argument missing"],
  ])('reports %j as a one-line usage_error', async (argv, message) => {
    const fetchSetup = createJsonFetch({})
    const { runtime, stderr } = createTestRuntime({ env: credentials, fetch: fetchSetup.fetch })

    await expect(runCli(argv, runtime)).resolves.toBe(2)

    expect(fetchSetup.calls).toHaveLength(0)
    const envelope = parseEnvelope(stderr.value) as { error: { code: string; message: string } }
    expect(envelope.error.code).toBe('usage_error')
    expect(envelope.error.message).toContain(message)
    expect(stderr.value).not.toContain('Usage:')
  })

  it('reports a group command without a subcommand as usage_error listing subcommands', async () => {
    const { runtime, stderr, stdout } = createTestRuntime()

    await expect(runCli(['node', 't212', 'orders'], runtime)).resolves.toBe(2)

    expect(stdout.value).toBe('')
    expect(parseEnvelope(stderr.value)).toEqual({
      error: {
        code: 'usage_error',
        message:
          '"t212 orders" requires a subcommand. Available subcommands: list, get, cancel, place. Run "t212 orders --help" for usage.',
        exitCode: 2,
        details: { command: 't212 orders', subcommands: ['list', 'get', 'cancel', 'place'] },
      },
    })
  })

  it('keeps Commander text in pretty mode, including the suggestion and help, and exits 2', async () => {
    const { runtime, stderr } = createTestRuntime()

    await expect(runCli(['node', 't212', '--output', 'pretty', 'ordrs'], runtime)).resolves.toBe(2)

    expect(stderr.value).toContain("error: unknown command 'ordrs'\n(Did you mean orders?)")
    expect(stderr.value).toContain('Usage: t212')
    expect(stderr.value).not.toContain('{"error"')
  })

  it('shows group help on stderr in pretty mode when the subcommand is missing', async () => {
    const { runtime, stderr, stdout } = createTestRuntime()

    await expect(runCli(['node', 't212', '--output=pretty', 'orders'], runtime)).resolves.toBe(2)

    expect(stdout.value).toBe('')
    expect(stderr.value).toContain('Usage: t212 orders')
    expect(stderr.value).not.toContain('{"error"')
  })
})

describe('pretty mode errors', () => {
  it('keeps the Error: <message> line for CliError', async () => {
    const { runtime, stderr } = createTestRuntime()

    await expect(
      runCli(
        ['node', 't212', '--output', 'pretty', '--environment', 'x', 'account', 'summary'],
        runtime,
      ),
    ).resolves.toBe(2)

    expect(stderr.value).toBe('Error: Invalid environment "x". Expected demo or live.\n')
  })

  it('keeps the Error: <message> line for API errors without leaking credentials', async () => {
    const fetchSetup = createJsonFetch({ message: 'nope' }, 403)
    const { runtime, stderr } = createTestRuntime({ env: credentials, fetch: fetchSetup.fetch })

    await expect(
      runCli(['node', 't212', 'account', 'summary', '--output', 'pretty'], runtime),
    ).resolves.toBe(4)

    expect(stderr.value).toBe('Error: Trading 212 API request failed with HTTP 403 Error\n')
    expectNoSecrets(stderr.value)
  })
})

describe('help and version are unaffected', () => {
  it.each([
    [['node', 't212', '--help'], 'Unofficial Trading 212 CLI'],
    [['node', 't212', 'help'], 'Unofficial Trading 212 CLI'],
    [['node', 't212', 'orders', '--help'], 'Place, inspect, and cancel equity orders.'],
    [['node', 't212', 'help', 'orders'], 'Place, inspect, and cancel equity orders.'],
    [['node', 't212', '--output', 'pretty', 'orders', '--help'], 'Usage: t212 orders'],
  ])('%j prints help to stdout and exits 0', async (argv, text) => {
    const { runtime, stderr, stdout } = createTestRuntime()

    await expect(runCli(argv, runtime)).resolves.toBe(0)

    expect(stdout.value).toContain(text)
    expect(stderr.value).toBe('')
  })

  it('prints the version and exits 0', async () => {
    const { runtime, stderr, stdout } = createTestRuntime()

    await expect(runCli(['node', 't212', '--version'], runtime)).resolves.toBe(0)

    expect(stdout.value.trim()).toMatch(/^\d+\.\d+\.\d+/)
    expect(stderr.value).toBe('')
  })
})

describe('output format detection', () => {
  it.each([
    [[], 'json'],
    [['--output', 'pretty'], 'pretty'],
    [['--output=pretty'], 'pretty'],
    [['account', 'summary', '--output', 'pretty'], 'pretty'],
    [['--output', 'pretty', '--output', 'json'], 'json'],
    [['--output', 'yaml'], 'json'],
    [['--output'], 'json'],
    [['--output='], 'json'],
    [['--', '--output', 'pretty'], 'json'],
  ])('detects %j as %s', (args, expected) => {
    expect(detectOutputFormat(['node', 't212', ...args])).toBe(expected)
  })

  it('treats every format except pretty as JSON output', () => {
    expect(isJsonOutput('json')).toBe(true)
    expect(isJsonOutput('pretty')).toBe(false)
  })
})
