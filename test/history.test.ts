import { describe, expect, it } from 'vitest'
import { createCli } from '../src/cli/app.ts'
import { runCli } from '../src/cli/run.ts'
import {
  createSequenceFetch,
  createTestRuntime,
  getFetchUrl,
  type MockResponse,
} from './helpers.ts'

const credentials = {
  T212_API_KEY: 'key',
  T212_API_SECRET: 'secret',
}

function setup(responses: MockResponse[]) {
  const fetchSetup = createSequenceFetch(responses)
  const testRuntime = createTestRuntime({ env: credentials, fetch: fetchSetup.fetch })

  return { ...testRuntime, calls: fetchSetup.calls }
}

describe('history pagination', () => {
  it('documents --all in history command help', () => {
    const { runtime } = createTestRuntime()
    const history = createCli(runtime).commands.find((command) => command.name() === 'history')

    for (const name of ['dividends', 'orders', 'transactions']) {
      const command = history?.commands.find((candidate) => candidate.name() === name)
      const help = command?.helpInformation() ?? ''

      expect(help).toContain('--all')
      expect(help).toContain('nextPagePath')
    }
  })

  it('returns a single page envelope unchanged without --all', async () => {
    const page = { items: [{ id: 1 }], nextPagePath: '/api/v0/equity/history/orders?cursor=5' }
    const { runtime, stdout, calls } = setup([{ body: page }])

    await expect(runCli(['node', 't212', 'history', 'orders'], runtime)).resolves.toBe(0)

    expect(calls).toHaveLength(1)
    expect(JSON.parse(stdout.value)).toEqual(page)
  })

  it('follows nextPagePath until null and prints all items as one array', async () => {
    const { runtime, stdout, calls, sleeps } = setup([
      {
        body: {
          items: [{ id: 1 }, { id: 2 }],
          nextPagePath:
            '/api/v0/equity/history/orders?limit=50&ticker=AAPL_US_EQ&cursor=1760346100000',
        },
      },
      {
        body: {
          items: [{ id: 3 }],
          nextPagePath:
            '/api/v0/equity/history/orders?limit=50&ticker=AAPL_US_EQ&cursor=1660015723000',
        },
      },
      { body: { items: [{ id: 4 }], nextPagePath: null } },
    ])

    await expect(
      runCli(
        [
          'node',
          't212',
          '--environment',
          'demo',
          'history',
          'orders',
          '--ticker',
          'AAPL_US_EQ',
          '--all',
        ],
        runtime,
      ),
    ).resolves.toBe(0)

    expect(calls.map(getFetchUrl)).toEqual([
      'https://demo.trading212.com/api/v0/equity/history/orders?limit=50&ticker=AAPL_US_EQ',
      'https://demo.trading212.com/api/v0/equity/history/orders?limit=50&ticker=AAPL_US_EQ&cursor=1760346100000',
      'https://demo.trading212.com/api/v0/equity/history/orders?limit=50&ticker=AAPL_US_EQ&cursor=1660015723000',
    ])
    expect(JSON.parse(stdout.value)).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }])
    expect(sleeps).toEqual([])
  })

  it('respects explicit --limit and --cursor as the starting page', async () => {
    const { runtime, stdout, calls } = setup([{ body: { items: [{ amount: 1 }] } }])

    await expect(
      runCli(
        ['node', 't212', 'history', 'dividends', '--all', '--limit', '10', '--cursor', '42'],
        runtime,
      ),
    ).resolves.toBe(0)

    expect(calls.map(getFetchUrl)).toEqual([
      'https://live.trading212.com/api/v0/equity/history/dividends?limit=10&cursor=42',
    ])
    expect(JSON.parse(stdout.value)).toEqual([{ amount: 1 }])
  })

  it('follows string cursors for transactions', async () => {
    const { runtime, stdout, calls } = setup([
      {
        body: {
          items: [{ reference: 'a' }],
          nextPagePath:
            '/api/v0/equity/history/transactions?limit=50&cursor=3f2a-uuid&time=2026-01-01T00%3A00%3A00Z',
        },
      },
      { body: { items: [{ reference: 'b' }] } },
    ])

    await expect(
      runCli(
        ['node', 't212', 'history', 'transactions', '--time', '2026-01-01T00:00:00Z', '--all'],
        runtime,
      ),
    ).resolves.toBe(0)

    expect(calls).toHaveLength(2)
    const second = new URL(getFetchUrl(calls[1] as (typeof calls)[number]))
    expect(second.pathname).toBe('/api/v0/equity/history/transactions')
    expect(second.searchParams.get('cursor')).toBe('3f2a-uuid')
    expect(second.searchParams.get('time')).toBe('2026-01-01T00:00:00Z')
    expect(JSON.parse(stdout.value)).toEqual([{ reference: 'a' }, { reference: 'b' }])
  })

  it('waits for the rate limit reset when the quota is exhausted', async () => {
    const reset = Math.ceil(Date.now() / 1000) + 30
    const { runtime, stdout, sleeps } = setup([
      {
        body: { items: [{ id: 1 }], nextPagePath: '/api/v0/equity/history/orders?cursor=1' },
        headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) },
      },
      {
        body: { items: [{ id: 2 }], nextPagePath: '/api/v0/equity/history/orders?cursor=2' },
        headers: { 'x-ratelimit-remaining': '4', 'x-ratelimit-reset': String(reset) },
      },
      { body: { items: [] } },
    ])

    await expect(runCli(['node', 't212', 'history', 'orders', '--all'], runtime)).resolves.toBe(0)

    expect(sleeps).toHaveLength(1)
    expect(sleeps[0]).toBeGreaterThan(25_000)
    expect(sleeps[0]).toBeLessThanOrEqual(32_000)
    expect(JSON.parse(stdout.value)).toEqual([{ id: 1 }, { id: 2 }])
  })

  it('refuses to follow a nextPagePath to another origin', async () => {
    const { runtime, stdout, stderr, calls } = setup([
      {
        body: {
          items: [{ id: 1 }],
          nextPagePath: 'https://attacker.example/api/v0/equity/history/orders?cursor=1',
        },
      },
    ])

    await expect(runCli(['node', 't212', 'history', 'orders', '--all'], runtime)).resolves.toBe(1)

    expect(calls).toHaveLength(1)
    expect(stdout.value).toBe('')
    expect(stderr.value).toContain('unexpected nextPagePath')
  })

  it('refuses to follow a nextPagePath to a different endpoint', async () => {
    const { runtime, stderr, calls } = setup([
      { body: { items: [], nextPagePath: '/api/v0/equity/orders?cursor=1' } },
    ])

    await expect(runCli(['node', 't212', 'history', 'dividends', '--all'], runtime)).resolves.toBe(
      1,
    )

    expect(calls).toHaveLength(1)
    expect(stderr.value).toContain('unexpected nextPagePath')
  })

  it('stops when the API repeats a nextPagePath', async () => {
    const page = { items: [{ id: 1 }], nextPagePath: '/api/v0/equity/history/orders?cursor=1' }
    const { runtime, stderr, calls } = setup([{ body: page }, { body: page }])

    await expect(runCli(['node', 't212', 'history', 'orders', '--all'], runtime)).resolves.toBe(1)

    expect(calls).toHaveLength(2)
    expect(stderr.value).toContain('already requested')
  })

  it('fails with the API exit code when a later page errors', async () => {
    const { runtime, stdout, stderr } = setup([
      { body: { items: [{ id: 1 }], nextPagePath: '/api/v0/equity/history/orders?cursor=1' } },
      { body: { code: 'Forbidden' }, status: 403 },
    ])

    await expect(runCli(['node', 't212', 'history', 'orders', '--all'], runtime)).resolves.toBe(4)

    expect(stdout.value).toBe('')
    expect(stderr.value).toContain('HTTP 403')
  })
})

describe('history streaming output', () => {
  const ordersPath = '/api/v0/equity/history/orders'

  it('prints a single page envelope as one ndjson line without --all', async () => {
    const page = { items: [{ id: 1 }, { id: 2 }], nextPagePath: `${ordersPath}?cursor=5` }
    const { runtime, stdout } = setup([{ body: page }])

    await expect(
      runCli(['node', 't212', '--output', 'ndjson', 'history', 'orders'], runtime),
    ).resolves.toBe(0)

    expect(stdout.value).toBe(`${JSON.stringify(page)}\n`)
  })

  it('prints all items on one line with --output json-compact', async () => {
    const { runtime, stdout } = setup([
      { body: { items: [{ id: 1 }], nextPagePath: `${ordersPath}?cursor=1` } },
      { body: { items: [{ id: 2 }], nextPagePath: null } },
    ])

    await expect(
      runCli(['node', 't212', '--output', 'json-compact', 'history', 'orders', '--all'], runtime),
    ).resolves.toBe(0)

    expect(stdout.value).toBe('[{"id":1},{"id":2}]\n')
  })

  it('streams each page to stdout before the next page is fetched', async () => {
    const responses = [
      { items: [{ id: 1 }, { id: 2 }], nextPagePath: `${ordersPath}?cursor=1` },
      { items: [], nextPagePath: `${ordersPath}?cursor=2` },
      { items: [{ id: 3 }], nextPagePath: null },
    ]
    const stdoutAtFetch: string[] = []
    let readStdout = () => ''
    const fetchMock: typeof fetch = async () => {
      stdoutAtFetch.push(readStdout())
      const body = responses[stdoutAtFetch.length - 1]

      return new Response(JSON.stringify(body), {
        headers: { 'content-type': 'application/json' },
      })
    }
    const { runtime, stdout } = createTestRuntime({ env: credentials, fetch: fetchMock })
    readStdout = () => stdout.value

    await expect(
      runCli(['node', 't212', '--output', 'ndjson', 'history', 'orders', '--all'], runtime),
    ).resolves.toBe(0)

    expect(stdoutAtFetch).toEqual(['', '{"id":1}\n{"id":2}\n', '{"id":1}\n{"id":2}\n'])
    expect(stdout.value).toBe('{"id":1}\n{"id":2}\n{"id":3}\n')
  })

  it('waits for stdout to accept a page before reporting progress or fetching more', async () => {
    const events: string[] = []
    const pendingWrites: Array<() => void> = []
    const responses = [
      { items: [{ id: 1 }], nextPagePath: `${ordersPath}?cursor=1` },
      { items: [{ id: 2 }], nextPagePath: null },
    ]
    const fetchMock: typeof fetch = async () => {
      events.push('fetch')
      return new Response(JSON.stringify(responses[events.filter((e) => e === 'fetch').length - 1]))
    }
    const { runtime } = createTestRuntime({ env: credentials, fetch: fetchMock })
    runtime.stdout = {
      write(chunk: string, callback?: (error?: Error | null) => void) {
        events.push(`stdout ${chunk.trim()}`)
        pendingWrites.push(() => {
          events.push('stdout flushed')
          callback?.()
        })
        return false
      },
    }
    runtime.stderr = {
      write(chunk: string) {
        events.push(`stderr page ${JSON.parse(chunk).progress.page}`)
        return true
      },
    }

    const run = runCli(
      ['node', 't212', '--output', 'ndjson', 'history', 'orders', '--all', '--progress'],
      runtime,
    )

    for (let flushed = 0; flushed < 2; flushed++) {
      await expect.poll(() => pendingWrites.length).toBe(1)
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(events.at(-1)).toMatch(/^stdout /)
      pendingWrites.shift()?.()
    }

    await expect(run).resolves.toBe(0)
    expect(events).toEqual([
      'fetch',
      'stdout {"id":1}',
      'stdout flushed',
      'stderr page 1',
      'fetch',
      'stdout {"id":2}',
      'stdout flushed',
      'stderr page 2',
    ])
  })

  it('stops quietly with exit 0 when the stdout reader goes away (EPIPE)', async () => {
    const { runtime, stderr, calls } = setup([
      { body: { items: [{ id: 1 }], nextPagePath: `${ordersPath}?cursor=1` } },
      { body: { items: [{ id: 2 }], nextPagePath: `${ordersPath}?cursor=2` } },
      { body: { items: [{ id: 3 }], nextPagePath: null } },
    ])
    const written: string[] = []
    runtime.stdout = {
      write(chunk: string, callback?: (error?: Error | null) => void) {
        written.push(chunk)
        callback?.(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }))
        return false
      },
    }

    await expect(
      runCli(
        ['node', 't212', '--output', 'ndjson', 'history', 'orders', '--all', '--progress'],
        runtime,
      ),
    ).resolves.toBe(0)

    expect(calls).toHaveLength(1)
    expect(written).toEqual(['{"id":1}\n'])
    expect(stderr.value).toBe('')
  })

  it('reports non-EPIPE stdout write errors through the normal error path', async () => {
    const { runtime, stderr, calls } = setup([
      { body: { items: [{ id: 1 }], nextPagePath: `${ordersPath}?cursor=1` } },
      { body: { items: [{ id: 2 }], nextPagePath: null } },
    ])
    runtime.stdout = {
      write(_chunk: string, callback?: (error?: Error | null) => void) {
        callback?.(Object.assign(new Error('write EIO'), { code: 'EIO' }))
        return false
      },
    }

    await expect(
      runCli(['node', 't212', '--output', 'ndjson', 'history', 'orders', '--all'], runtime),
    ).resolves.toBe(1)

    expect(calls).toHaveLength(1)
    expect(stderr.value).toBe(
      `${JSON.stringify({
        error: {
          code: 'output_write_failed',
          message: 'Failed to write output: write EIO',
          exitCode: 1,
          details: { cause: 'EIO' },
        },
      })}\n`,
    )
  })

  it('keeps already streamed items and exits non-zero when a later page fails', async () => {
    const { runtime, stdout, stderr } = setup([
      { body: { items: [{ id: 1 }, { id: 2 }], nextPagePath: `${ordersPath}?cursor=1` } },
      { body: { code: 'Forbidden' }, status: 403 },
    ])

    await expect(
      runCli(['node', 't212', '--output', 'ndjson', 'history', 'orders', '--all'], runtime),
    ).resolves.toBe(4)

    expect(stdout.value).toBe('{"id":1}\n{"id":2}\n')
    expect(
      stdout.value
        .trimEnd()
        .split('\n')
        .map((line) => JSON.parse(line)),
    ).toEqual([{ id: 1 }, { id: 2 }])
    expect(stderr.value).toContain('HTTP 403')
  })

  it.each([
    'ndjson',
    'json-compact',
  ])('prints the one-line error envelope after progress lines with --output %s', async (format) => {
    const { runtime, stderr } = setup([
      { body: { items: [{ id: 1 }], nextPagePath: `${ordersPath}?cursor=1` } },
      { body: { code: 'Forbidden' }, status: 403 },
    ])

    await expect(
      runCli(
        ['node', 't212', '--output', format, 'history', 'orders', '--all', '--progress'],
        runtime,
      ),
    ).resolves.toBe(4)

    const lines = stderr.value.trimEnd().split('\n')
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0] as string)).toEqual({
      progress: { items: 1, nextPagePath: `${ordersPath}?cursor=1`, page: 1, total: 1 },
    })
    expect(JSON.parse(lines[1] as string)).toMatchObject({
      error: { code: 'api_error', exitCode: 4 },
    })
  })

  it.each([
    'ndjson',
    'json-compact',
  ])('reports --next-page-path conflicts as a JSON envelope with --output %s', async (format) => {
    const { runtime, stderr } = setup([])

    await expect(
      runCli(
        [
          'node',
          't212',
          '--output',
          format,
          'history',
          'orders',
          '--next-page-path',
          `${ordersPath}?cursor=1`,
          '--limit',
          '5',
        ],
        runtime,
      ),
    ).resolves.toBe(2)

    expect(stderr.value.split('\n')).toHaveLength(2)
    expect(JSON.parse(stderr.value)).toMatchObject({
      error: { code: 'conflicting_options', exitCode: 2 },
    })
  })

  it('writes one JSON progress line per page to stderr with --progress', async () => {
    const { runtime, stdout, stderr } = setup([
      { body: { items: [{ id: 1 }, { id: 2 }], nextPagePath: `${ordersPath}?cursor=1` } },
      { body: { items: [{ id: 3 }], nextPagePath: null } },
    ])

    await expect(
      runCli(
        ['node', 't212', '--output', 'ndjson', 'history', 'orders', '--all', '--progress'],
        runtime,
      ),
    ).resolves.toBe(0)

    expect(stdout.value).toBe('{"id":1}\n{"id":2}\n{"id":3}\n')
    expect(
      stderr.value
        .trimEnd()
        .split('\n')
        .map((line) => JSON.parse(line)),
    ).toEqual([
      { progress: { page: 1, items: 2, total: 2, nextPagePath: `${ordersPath}?cursor=1` } },
      { progress: { page: 2, items: 1, total: 3, nextPagePath: null } },
    ])
  })

  it('writes human-readable progress lines in pretty mode', async () => {
    const { runtime, stderr } = setup([
      { body: { items: [{ id: 1 }], nextPagePath: `${ordersPath}?cursor=1` } },
      { body: { items: [], nextPagePath: null } },
    ])

    await expect(
      runCli(
        ['node', 't212', '--output', 'pretty', 'history', 'orders', '--all', '--progress'],
        runtime,
      ),
    ).resolves.toBe(0)

    expect(stderr.value).toBe(
      `Page 1: 1 items (1 total), next: ${ordersPath}?cursor=1\nPage 2: 0 items (1 total), last page\n`,
    )
  })

  it('writes the single page before its progress line without --all', async () => {
    const page = { items: [{ id: 1 }], nextPagePath: `${ordersPath}?cursor=1` }
    const { runtime } = setup([{ body: page }])
    const events: string[] = []
    runtime.stdout = {
      write(chunk: string) {
        events.push(`stdout ${chunk.trim()}`)
        return true
      },
    }
    runtime.stderr = {
      write(chunk: string) {
        events.push(`stderr ${chunk.trim()}`)
        return true
      },
    }

    await expect(
      runCli(['node', 't212', '--output', 'ndjson', 'history', 'orders', '--progress'], runtime),
    ).resolves.toBe(0)

    expect(events).toEqual([
      `stdout ${JSON.stringify(page)}`,
      `stderr ${JSON.stringify({ progress: { items: 1, nextPagePath: page.nextPagePath, page: 1, total: 1 } })}`,
    ])
  })

  it('writes nothing to stderr without --progress', async () => {
    const { runtime, stderr } = setup([{ body: { items: [{ id: 1 }], nextPagePath: null } }])

    await expect(runCli(['node', 't212', 'history', 'orders', '--all'], runtime)).resolves.toBe(0)

    expect(stderr.value).toBe('')
  })
})

describe('history --next-page-path', () => {
  const ordersPath = '/api/v0/equity/history/orders'

  it('documents --progress and --next-page-path in history command help', () => {
    const { runtime } = createTestRuntime()
    const history = createCli(runtime).commands.find((command) => command.name() === 'history')

    for (const name of ['dividends', 'orders', 'transactions']) {
      const command = history?.commands.find((candidate) => candidate.name() === name)
      const help = command?.helpInformation() ?? ''

      expect(help).toContain('--progress')
      expect(help).toContain('--next-page-path')
    }
  })

  it('names only flags each command actually has in the --next-page-path help', () => {
    const { runtime } = createTestRuntime()
    const history = createCli(runtime).commands.find((command) => command.name() === 'history')
    const flagsFor = (name: string) => {
      const option = history?.commands
        .find((candidate) => candidate.name() === name)
        ?.options.find((candidate) => candidate.long === '--next-page-path')
      return option?.description.match(/--[a-z-]+/g) ?? []
    }

    expect(flagsFor('dividends')).toEqual(['--ticker', '--cursor', '--limit'])
    expect(flagsFor('orders')).toEqual(['--ticker', '--cursor', '--limit'])
    expect(flagsFor('transactions')).toEqual(['--cursor', '--time', '--limit'])
  })

  it('resumes --all from a previously printed nextPagePath', async () => {
    const start = `${ordersPath}?limit=50&ticker=AAPL_US_EQ&cursor=1760346100000`
    const { runtime, stdout, calls } = setup([
      { body: { items: [{ id: 3 }], nextPagePath: `${ordersPath}?limit=50&cursor=99` } },
      { body: { items: [{ id: 4 }], nextPagePath: null } },
    ])

    await expect(
      runCli(
        [
          'node',
          't212',
          '--environment',
          'demo',
          '--output',
          'ndjson',
          'history',
          'orders',
          '--all',
          '--next-page-path',
          start,
        ],
        runtime,
      ),
    ).resolves.toBe(0)

    expect(calls.map(getFetchUrl)).toEqual([
      `https://demo.trading212.com${start}`,
      `https://demo.trading212.com${ordersPath}?limit=50&cursor=99`,
    ])
    expect(stdout.value).toBe('{"id":3}\n{"id":4}\n')
  })

  it('fetches a single page from --next-page-path without --all', async () => {
    const page = { items: [{ id: 1 }], nextPagePath: null }
    const { runtime, stdout, calls } = setup([{ body: page }])

    await expect(
      runCli(
        [
          'node',
          't212',
          'history',
          'transactions',
          '--next-page-path',
          '/api/v0/equity/history/transactions?cursor=abc',
        ],
        runtime,
      ),
    ).resolves.toBe(0)

    expect(calls.map(getFetchUrl)).toEqual([
      'https://live.trading212.com/api/v0/equity/history/transactions?cursor=abc',
    ])
    expect(JSON.parse(stdout.value)).toEqual(page)
  })

  it('treats the starting path as already requested for loop detection', async () => {
    const start = `${ordersPath}?cursor=1`
    const { runtime, stderr, calls } = setup([{ body: { items: [], nextPagePath: start } }])

    await expect(
      runCli(['node', 't212', 'history', 'orders', '--all', '--next-page-path', start], runtime),
    ).resolves.toBe(1)

    expect(calls).toHaveLength(1)
    expect(stderr.value).toContain('already requested')
  })

  it('detects a loop back to an absolute start path given in relative, reordered form', async () => {
    const { runtime, stdout, stderr, calls } = setup([
      { body: { items: [{ id: 1 }], nextPagePath: `${ordersPath}?limit=50&cursor=1` } },
    ])

    await expect(
      runCli(
        [
          'node',
          't212',
          '--output',
          'ndjson',
          'history',
          'orders',
          '--all',
          '--next-page-path',
          `https://live.trading212.com${ordersPath}?cursor=1&limit=50`,
        ],
        runtime,
      ),
    ).resolves.toBe(1)

    expect(calls).toHaveLength(1)
    expect(stdout.value).toBe('{"id":1}\n')
    expect(stderr.value).toContain('already requested')
  })

  it('rejects a foreign origin before resolving credentials or calling the API', async () => {
    const fetchSetup = createSequenceFetch([])
    const { runtime, stderr } = createTestRuntime({ fetch: fetchSetup.fetch })

    await expect(
      runCli(
        [
          'node',
          't212',
          'history',
          'orders',
          '--all',
          '--next-page-path',
          `https://attacker.example${ordersPath}?cursor=1`,
        ],
        runtime,
      ),
    ).resolves.toBe(2)

    expect(fetchSetup.calls).toHaveLength(0)
    expect(stderr.value).toContain('Invalid --next-page-path')
    expect(stderr.value).not.toContain('credentials')
  })

  it('rejects a path for a different endpoint', async () => {
    const { runtime, stderr, calls } = setup([])

    await expect(
      runCli(
        [
          'node',
          't212',
          'history',
          'dividends',
          '--next-page-path',
          '/api/v0/equity/history/orders?cursor=1',
        ],
        runtime,
      ),
    ).resolves.toBe(2)

    expect(calls).toHaveLength(0)
    expect(stderr.value).toContain('Invalid --next-page-path for the live environment')
    expect(stderr.value).toContain('/api/v0/equity/history/dividends')
  })

  it.each([
    ['orders', '--cursor', '5'],
    ['orders', '--limit', '10'],
    ['dividends', '--ticker', 'AAPL_US_EQ'],
    ['transactions', '--time', '2026-01-01T00:00:00Z'],
  ])('rejects --next-page-path on %s combined with %s', async (name, flag, value) => {
    const { runtime, stderr, calls } = setup([])

    await expect(
      runCli(
        [
          'node',
          't212',
          'history',
          name,
          '--next-page-path',
          `/api/v0/equity/history/${name}?cursor=1`,
          flag,
          value,
        ],
        runtime,
      ),
    ).resolves.toBe(2)

    expect(calls).toHaveLength(0)
    expect(stderr.value).toContain('cannot be combined')
    expect(stderr.value).toContain(flag)
  })
})
