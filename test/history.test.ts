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
