import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { runCli } from '../src/cli/run.ts'
import { runPromptUntilInputEnds } from '../src/runtime-prompts.ts'
import { createJsonFetch, createTestRuntime } from './helpers.ts'

const credentials = {
  T212_API_KEY: 'key',
  T212_API_SECRET: 'secret',
}

function exitPromptError(): Error {
  const error = new Error('User force closed the prompt with 13 null')
  error.name = 'ExitPromptError'
  return error
}

/** Asserts stderr is exactly one JSON line and returns the parsed envelope. */
function parseEnvelope(stderr: string): unknown {
  expect(stderr.endsWith('\n')).toBe(true)
  const lines = stderr.slice(0, -1).split('\n')
  expect(lines).toHaveLength(1)
  return JSON.parse(lines[0] ?? '')
}

describe('prompt cancellation', () => {
  it('reports a cancelled login prompt as prompt_cancelled with exit code 2', async () => {
    const { runtime, stderr, stdout, store } = createTestRuntime({
      prompts: {
        input: async () => {
          throw exitPromptError()
        },
      },
    })

    await expect(runCli(['node', 't212', 'login'], runtime)).resolves.toBe(2)

    expect(stdout.value).toBe('')
    expect(store.values.size).toBe(0)
    expect(parseEnvelope(stderr.value)).toEqual({
      error: {
        code: 'prompt_cancelled',
        message: 'Login cancelled: the prompt was closed before credentials were entered.',
        exitCode: 2,
        details: null,
      },
    })
    expect(stderr.value).not.toContain('force closed')
  })

  it('reports a cancelled secret prompt as prompt_cancelled without echoing the key', async () => {
    const { runtime, stderr, store } = createTestRuntime({
      prompts: {
        input: async () => 'typed-key',
        password: async () => {
          throw exitPromptError()
        },
      },
    })

    await expect(runCli(['node', 't212', 'login'], runtime)).resolves.toBe(2)

    expect(store.values.size).toBe(0)
    expect(parseEnvelope(stderr.value)).toMatchObject({
      error: { code: 'prompt_cancelled', exitCode: 2 },
    })
    expect(stderr.value).not.toContain('typed-key')
  })

  it('treats a cancelled write confirmation like answering no, before network I/O', async () => {
    const fetchSetup = createJsonFetch({})
    const { runtime, stderr } = createTestRuntime({
      env: credentials,
      fetch: fetchSetup.fetch,
      isTTY: true,
      prompts: {
        confirm: async () => {
          throw exitPromptError()
        },
      },
    })

    await expect(runCli(['node', 't212', 'orders', 'cancel', '123'], runtime)).resolves.toBe(3)

    expect(fetchSetup.calls).toHaveLength(0)
    expect(parseEnvelope(stderr.value)).toEqual({
      error: {
        code: 'write_not_confirmed',
        message: 'Refusing to cancel order 123 without confirmation.',
        exitCode: 3,
        details: null,
      },
    })
  })

  it('still reports other prompt failures as internal_error', async () => {
    const fetchSetup = createJsonFetch({})
    const { runtime, stderr } = createTestRuntime({
      env: credentials,
      fetch: fetchSetup.fetch,
      isTTY: true,
      prompts: {
        confirm: async () => {
          throw new Error('terminal exploded')
        },
      },
    })

    await expect(runCli(['node', 't212', 'orders', 'cancel', '123'], runtime)).resolves.toBe(1)

    expect(fetchSetup.calls).toHaveLength(0)
    expect(parseEnvelope(stderr.value)).toMatchObject({
      error: { code: 'internal_error', message: 'terminal exploded' },
    })
  })
})

describe('runPromptUntilInputEnds', () => {
  // Mirrors inquirer: rejects immediately on an already-aborted signal, or on abort.
  const waitForAbort = (signal: AbortSignal) =>
    new Promise<never>((_resolve, reject) => {
      if (signal.aborted) {
        reject(new Error('aborted by signal'))
        return
      }

      signal.addEventListener('abort', () => reject(new Error('aborted by signal')))
    })

  it('cancels a pending prompt with an ExitPromptError when input ends', async () => {
    const input = new PassThrough()
    const pending = runPromptUntilInputEnds(input, waitForAbort)

    input.resume()
    input.end()

    await expect(pending).rejects.toMatchObject({ name: 'ExitPromptError' })
    expect(input.listenerCount('end')).toBe(0)
  })

  it('cancels immediately when input has already ended', async () => {
    const input = new PassThrough()
    const ended = new Promise((resolve) => input.once('end', resolve))
    input.resume()
    input.end()
    await ended

    await expect(runPromptUntilInputEnds(input, waitForAbort)).rejects.toMatchObject({
      name: 'ExitPromptError',
    })
  })

  it('passes answers and unrelated errors through unchanged', async () => {
    const input = new PassThrough()

    await expect(runPromptUntilInputEnds(input, async () => 'answer')).resolves.toBe('answer')
    await expect(
      runPromptUntilInputEnds(input, async () => {
        throw new Error('other failure')
      }),
    ).rejects.toThrow('other failure')
    expect(input.listenerCount('end')).toBe(0)
  })
})
