import { describe, expect, it } from 'vitest'
import { parseBooleanEnv, resolveRuntimeConfig } from '../src/config/runtime-config.ts'
import { assertWriteAllowed } from '../src/safety/write-guard.ts'
import { createTestRuntime } from './helpers.ts'

const command = (options: Record<string, unknown>) => ({
  optsWithGlobals: () => options,
})

describe('runtime config', () => {
  it('defaults to live JSON output with read-only disabled', () => {
    const { runtime } = createTestRuntime()

    expect(resolveRuntimeConfig(command({}), runtime)).toEqual({
      baseUrl: 'https://live.trading212.com',
      environment: 'live',
      output: 'json',
      readOnly: false,
    })
  })

  it('uses CLI options before env vars', () => {
    const { runtime } = createTestRuntime({
      env: {
        T212_ENVIRONMENT: 'live',
        T212_READ_ONLY: 'false',
      },
    })

    expect(
      resolveRuntimeConfig(
        command({ environment: 'demo', output: 'pretty', readOnly: true }),
        runtime,
      ),
    ).toMatchObject({
      baseUrl: 'https://demo.trading212.com',
      environment: 'demo',
      output: 'pretty',
      readOnly: true,
    })
  })

  it('parses boolean env values explicitly', () => {
    expect(parseBooleanEnv('true')).toBe(true)
    expect(parseBooleanEnv('0')).toBe(false)
    expect(() => parseBooleanEnv('maybe')).toThrow('Invalid T212_READ_ONLY value')
  })
})

describe('write guard', () => {
  it('blocks writes in read-only mode before confirmation', async () => {
    const { runtime } = createTestRuntime({
      prompts: {
        confirm: async () => true,
      },
    })

    await expect(
      assertWriteAllowed({
        action: 'place an order',
        config: {
          baseUrl: 'https://live.trading212.com',
          environment: 'live',
          output: 'json',
          readOnly: true,
        },
        runtime,
        yes: true,
      }),
    ).rejects.toMatchObject({
      code: 'read_only_violation',
      exitCode: 3,
    })
  })

  it('requires --yes in non-interactive shells', async () => {
    const { runtime } = createTestRuntime({ isTTY: false })

    await expect(
      assertWriteAllowed({
        action: 'cancel an order',
        config: {
          baseUrl: 'https://live.trading212.com',
          environment: 'live',
          output: 'json',
          readOnly: false,
        },
        runtime,
        yes: false,
      }),
    ).rejects.toMatchObject({
      code: 'missing_yes',
      exitCode: 3,
    })
  })

  it('allows interactive confirmation when --yes is absent', async () => {
    const { runtime } = createTestRuntime({
      isTTY: true,
      prompts: {
        confirm: async () => true,
      },
    })

    await expect(
      assertWriteAllowed({
        action: 'request a report',
        config: {
          baseUrl: 'https://live.trading212.com',
          environment: 'live',
          output: 'json',
          readOnly: false,
        },
        runtime,
        yes: false,
      }),
    ).resolves.toBeUndefined()
  })
})
