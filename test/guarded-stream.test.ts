import { Writable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { runCli } from '../src/cli/run.ts'
import { createGuardedWritable } from '../src/output/guarded-stream.ts'
import { createJsonFetch, createTestRuntime } from './helpers.ts'

function failingStream(code: string): { stream: Writable; writes: string[] } {
  const writes: string[] = []
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      writes.push(String(chunk))
      callback(Object.assign(new Error(`write ${code}`), { code }))
    },
  })

  return { stream, writes }
}

function nextTick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

describe('guarded output streams', () => {
  it('records EPIPE instead of raising an uncaught error and short-circuits later writes', async () => {
    const { stream, writes } = failingStream('EPIPE')
    const guarded = createGuardedWritable(stream)
    const errors: Array<Error | null | undefined> = []

    guarded.write('first\n', (error) => errors.push(error))
    await nextTick()
    guarded.write('second\n', (error) => errors.push(error))
    await nextTick()

    expect(writes).toEqual(['first\n'])
    expect(errors.map((error) => (error as { code?: string } | null)?.code)).toEqual([
      'EPIPE',
      'EPIPE',
    ])
    expect((guarded.failure() as { code?: string } | undefined)?.code).toBe('EPIPE')
  })

  it('exits 0 quietly when stdout reported EPIPE for an unawaited write', async () => {
    const fetchSetup = createJsonFetch([{ ticker: 'A' }])
    const { runtime, stderr } = createTestRuntime({
      env: { T212_API_KEY: 'key', T212_API_SECRET: 'secret' },
      fetch: fetchSetup.fetch,
    })
    const { stream } = failingStream('EPIPE')
    const guarded = createGuardedWritable(stream)
    runtime.stdout = guarded
    runtime.stdoutFailure = guarded.failure

    const code = await runCli(['node', 't212', 'positions', 'list'], runtime)
    await nextTick()

    expect(code).toBe(0)
    expect((guarded.failure() as { code?: string } | undefined)?.code).toBe('EPIPE')
    expect(stderr.value).toBe('')
  })

  async function runWithFailedStdout(output: string) {
    const fetchSetup = createJsonFetch([{ ticker: 'A' }])
    const { runtime, stderr } = createTestRuntime({
      env: { T212_API_KEY: 'key', T212_API_SECRET: 'secret' },
      fetch: fetchSetup.fetch,
    })
    const guarded = createGuardedWritable(failingStream('EIO').stream)
    runtime.stdout = guarded
    runtime.stdoutFailure = () => guarded.failure()

    // Prime the failure, as a real stream would after a previous failed write.
    guarded.write('x', () => {})
    await nextTick()

    const code = await runCli(['node', 't212', '--output', output, 'positions', 'list'], runtime)
    return { code, stderr: stderr.value }
  }

  it('reports a non-EPIPE stdout failure as a JSON envelope with exit 1', async () => {
    for (const output of ['json', 'json-compact', 'ndjson']) {
      const { code, stderr } = await runWithFailedStdout(output)

      expect(code).toBe(1)
      expect(stderr.endsWith('\n')).toBe(true)
      expect(stderr.trimEnd().split('\n')).toHaveLength(1)
      expect(JSON.parse(stderr)).toEqual({
        error: {
          code: 'output_write_failed',
          message: 'Failed to write output: write EIO',
          exitCode: 1,
          details: { cause: 'EIO' },
        },
      })
    }
  })

  it('reports a non-EPIPE stdout failure as text in pretty mode', async () => {
    const { code, stderr } = await runWithFailedStdout('pretty')

    expect(code).toBe(1)
    expect(stderr).toBe('Error: Failed to write output: write EIO\n')
  })
})
