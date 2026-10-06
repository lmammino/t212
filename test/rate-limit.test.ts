import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runCli } from '../src/cli/run.ts'
import { resolveRuntimeConfig } from '../src/config/runtime-config.ts'
import { unwrapApiResponse } from '../src/http/client.ts'
import {
  computeRetryWait,
  createRateLimitedFetch,
  parseRateLimitHeaders,
  parseRetryAfter,
} from '../src/http/rate-limit.ts'
import {
  BufferWriter,
  createSequenceFetch,
  createTestRuntime,
  getFetchUrl,
  getRequestHeader,
  type MockResponse,
} from './helpers.ts'

const now = 1_760_000_000_000
const nowSeconds = now / 1000

const credentials = {
  T212_API_KEY: 'key',
  T212_API_SECRET: 'secret',
}

const quotaHeaders = (remaining: number, reset = nowSeconds + 30) => ({
  'x-ratelimit-limit': '6',
  'x-ratelimit-period': '60',
  'x-ratelimit-remaining': String(remaining),
  'x-ratelimit-reset': String(reset),
  'x-ratelimit-used': String(6 - remaining),
})

const tooManyRequests = (headers: Record<string, string> = {}): MockResponse => ({
  body: { code: 'TooManyRequests' },
  headers,
  status: 429,
})

function setup(responses: MockResponse[], env: NodeJS.ProcessEnv = {}) {
  const fetchSetup = createSequenceFetch(responses)
  const testRuntime = createTestRuntime({
    env: { ...credentials, ...env },
    fetch: fetchSetup.fetch,
  })

  return { ...testRuntime, calls: fetchSetup.calls }
}

function stderrJsonLines(value: string): unknown[] {
  return value
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line) as unknown)
}

const summary = ['node', 't212', 'account', 'summary']

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(now)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('rate limit header parsing and wait computation', () => {
  it('parses x-ratelimit-* headers into numbers or null', () => {
    expect(parseRateLimitHeaders(new Headers(quotaHeaders(2)))).toEqual({
      limit: 6,
      period: 60,
      remaining: 2,
      reset: nowSeconds + 30,
      used: 4,
    })
    expect(parseRateLimitHeaders(new Headers({ 'x-ratelimit-limit': 'abc' }))).toEqual({
      limit: null,
      period: null,
      remaining: null,
      reset: null,
      used: null,
    })
  })

  it('derives the wait from x-ratelimit-reset plus a 1s buffer', () => {
    const headers = new Headers({
      'x-ratelimit-reset': String(nowSeconds + 42),
      'retry-after': '5',
    })

    expect(computeRetryWait({ attempt: 0, headers, now, random: () => 0.5 })).toBe(43_000)
  })

  it('waits 1s when x-ratelimit-reset is already in the past', () => {
    const headers = new Headers({ 'x-ratelimit-reset': String(nowSeconds - 10) })

    expect(computeRetryWait({ attempt: 2, headers, now, random: () => 0.5 })).toBe(1_000)
  })

  it('falls back to Retry-After in seconds or as an HTTP-date', () => {
    expect(
      computeRetryWait({
        attempt: 0,
        headers: new Headers({ 'retry-after': '7' }),
        now,
        random: () => 0.5,
      }),
    ).toBe(7_000)

    const date = new Date(now + 12_000).toUTCString()
    expect(parseRetryAfter(date, now)).toBe(12_000)
    expect(parseRetryAfter(new Date(now - 5_000).toUTCString(), now)).toBe(0)
    expect(
      computeRetryWait({
        attempt: 0,
        headers: new Headers({ 'retry-after': '0' }),
        now,
        random: () => 0.5,
      }),
    ).toBe(1_000)
    expect(parseRetryAfter('not a date', now)).toBeUndefined()
    expect(parseRetryAfter(null, now)).toBeUndefined()
  })

  it('falls back to exponential backoff with ±20% jitter', () => {
    const headers = new Headers()
    const wait = (attempt: number, random: number) =>
      computeRetryWait({ attempt, headers, now, random: () => random })

    expect(wait(0, 0.5)).toBe(1_000)
    expect(wait(1, 0.5)).toBe(2_000)
    expect(wait(2, 0.5)).toBe(4_000)
    expect(wait(0, 0)).toBe(800)
    expect(wait(0, 0.999_999)).toBe(1_200)
    expect(wait(2, 0)).toBe(3_200)
    expect(wait(2, 0.999_999)).toBe(4_800)

    for (let index = 0; index < 50; index++) {
      const value = computeRetryWait({ attempt: 1, headers, now, random: Math.random })
      expect(value).toBeGreaterThanOrEqual(1_600)
      expect(value).toBeLessThanOrEqual(2_400)
    }
  })
})

describe('retrying rate-limited reads', () => {
  it('retries a 429 GET and succeeds, waiting until x-ratelimit-reset', async () => {
    const { runtime, stdout, stderr, sleeps, calls } = setup([
      tooManyRequests(quotaHeaders(0, nowSeconds + 42)),
      { body: { currency: 'GBP' }, headers: quotaHeaders(5) },
    ])

    await expect(runCli(summary, runtime)).resolves.toBe(0)

    expect(calls).toHaveLength(2)
    expect(sleeps).toEqual([43_000])
    expect(JSON.parse(stdout.value)).toEqual({ currency: 'GBP' })
    expect(stderr.value).toBe('')
  })

  it('re-sends the same URL, query string and Authorization header on retry', async () => {
    const { runtime, calls } = setup([
      tooManyRequests({ 'retry-after': '2' }),
      { body: { items: [] } },
    ])

    await expect(
      runCli(['node', 't212', 'history', 'orders', '--limit', '5', '--cursor', '42'], runtime),
    ).resolves.toBe(0)

    expect(calls).toHaveLength(2)
    const [first, second] = calls as [(typeof calls)[number], (typeof calls)[number]]
    expect(getFetchUrl(first)).toBe(
      'https://live.trading212.com/api/v0/equity/history/orders?cursor=42&limit=5',
    )
    expect(getFetchUrl(second)).toBe(getFetchUrl(first))
    expect(getRequestHeader(second, 'authorization')).toBe('Basic a2V5OnNlY3JldA==')
    expect(getRequestHeader(first, 'authorization')).toBe('Basic a2V5OnNlY3JldA==')
  })

  it('floors Retry-After: 0 at 1s so retries never run back to back', async () => {
    const { runtime, sleeps } = setup([
      tooManyRequests({ 'retry-after': '0' }),
      tooManyRequests({ 'retry-after': new Date(now - 5_000).toUTCString() }),
      { body: {} },
    ])

    await expect(runCli(summary, runtime)).resolves.toBe(0)
    expect(sleeps).toEqual([1_000, 1_000])
  })

  it('still retries when discarding the 429 body fails', async () => {
    let attempt = 0
    const fetchMock: typeof fetch = async () => {
      attempt++

      if (attempt === 1) {
        const body = new ReadableStream({
          start(controller) {
            controller.error(new Error('connection reset'))
          },
        })

        return new Response(body, { headers: { 'retry-after': '1' }, status: 429 })
      }

      return new Response('{}', { headers: { 'content-type': 'application/json' }, status: 200 })
    }
    const { runtime, sleeps } = createTestRuntime({ env: credentials, fetch: fetchMock })

    await expect(runCli(summary, runtime)).resolves.toBe(0)
    expect(attempt).toBe(2)
    expect(sleeps).toEqual([1_000])
  })

  it('waits 1s when the reset timestamp is already past', async () => {
    const { runtime, sleeps } = setup([
      tooManyRequests(quotaHeaders(0, nowSeconds - 5)),
      { body: {} },
    ])

    await expect(runCli(summary, runtime)).resolves.toBe(0)
    expect(sleeps).toEqual([1_000])
  })

  it('uses Retry-After when there is no x-ratelimit-reset header', async () => {
    const { runtime, sleeps } = setup([tooManyRequests({ 'retry-after': '3' }), { body: {} }])

    await expect(runCli(summary, runtime)).resolves.toBe(0)
    expect(sleeps).toEqual([3_000])
  })

  it('uses exponential backoff when no timing headers are present', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const { runtime, sleeps } = setup([
      tooManyRequests(),
      tooManyRequests(),
      tooManyRequests(),
      { body: {} },
    ])

    await expect(runCli(summary, runtime)).resolves.toBe(0)
    expect(sleeps).toEqual([1_000, 2_000, 4_000])
  })

  it('fails with exit code 6 after exhausting retries', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const { runtime, stdout, stderr, sleeps, calls } = setup([
      tooManyRequests(),
      tooManyRequests(),
      tooManyRequests(),
      tooManyRequests(),
    ])

    await expect(runCli(summary, runtime)).resolves.toBe(6)

    expect(calls).toHaveLength(4)
    expect(sleeps).toEqual([1_000, 2_000, 4_000])
    expect(stdout.value).toBe('')
    const lines = stderr.value.trimEnd().split('\n')
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0] ?? '')).toEqual({
      error: {
        code: 'rate_limited',
        message: 'Trading 212 API rate limit exceeded (HTTP 429 Error) after 3 retries',
        exitCode: 6,
        details: {
          status: 429,
          statusText: 'Error',
          body: { code: 'TooManyRequests' },
          rateLimit: { limit: null, period: null, remaining: null, reset: null, used: null },
          retries: 3,
        },
      },
    })
  })

  it('reports the parsed quota headers in the envelope details', async () => {
    const { runtime, stderr } = setup([tooManyRequests(quotaHeaders(0))], {
      T212_MAX_RETRIES: '0',
    })

    await expect(runCli(summary, runtime)).resolves.toBe(6)
    expect(JSON.parse(stderr.value)).toMatchObject({
      error: {
        code: 'rate_limited',
        details: {
          rateLimit: { limit: 6, period: 60, remaining: 0, reset: nowSeconds + 30, used: 6 },
          retries: 0,
        },
      },
    })
  })

  it('retries a rate-limited page during --all pagination and keeps every item', async () => {
    const { runtime, stdout, sleeps, calls } = setup([
      { body: { items: [{ id: 1 }], nextPagePath: '/api/v0/equity/history/orders?cursor=1' } },
      tooManyRequests({ 'retry-after': '2' }),
      { body: { items: [{ id: 2 }], nextPagePath: null } },
    ])

    await expect(runCli(['node', 't212', 'history', 'orders', '--all'], runtime)).resolves.toBe(0)

    expect(calls).toHaveLength(3)
    expect(calls[2] === undefined ? '' : getFetchUrl(calls[2])).toBe(
      calls[1] === undefined ? 'missing' : getFetchUrl(calls[1]),
    )
    expect(sleeps).toEqual([2_000])
    expect(JSON.parse(stdout.value)).toEqual([{ id: 1 }, { id: 2 }])
  })

  it('streams ndjson pages around a retried page', async () => {
    const { runtime, stdout, sleeps } = setup([
      { body: { items: [{ id: 1 }], nextPagePath: '/api/v0/equity/history/orders?cursor=1' } },
      tooManyRequests({ 'retry-after': '1' }),
      { body: { items: [{ id: 2 }], nextPagePath: null } },
    ])

    await expect(
      runCli(['node', 't212', '--output', 'ndjson', 'history', 'orders', '--all'], runtime),
    ).resolves.toBe(0)

    expect(sleeps).toEqual([1_000])
    expect(stdout.value).toBe('{"id":1}\n{"id":2}\n')
  })

  it('fails immediately when the next wait would exceed the 120s cap', async () => {
    // Each 429 reports a reset 60s ahead, so a second 61s wait would total 122s.
    const { runtime, sleeps, calls, stderr } = setup([
      tooManyRequests(quotaHeaders(0, nowSeconds + 60)),
      tooManyRequests(quotaHeaders(0, nowSeconds + 60)),
      { body: {} },
    ])
    await expect(runCli(summary, runtime)).resolves.toBe(6)

    expect(calls).toHaveLength(2)
    expect(sleeps).toEqual([61_000])
    expect(stderr.value).toContain('after 1 retry')
  })

  it('rejects a single wait longer than the cap without sleeping', async () => {
    const { runtime, sleeps, calls } = setup([tooManyRequests(quotaHeaders(0, nowSeconds + 300))])

    await expect(runCli(summary, runtime)).resolves.toBe(6)
    expect(calls).toHaveLength(1)
    expect(sleeps).toEqual([])
  })

  it('does not retry when --max-retries is 0', async () => {
    const { runtime, sleeps, calls } = setup([tooManyRequests(), { body: {} }])

    await expect(
      runCli(['node', 't212', '--max-retries', '0', ...summary.slice(2)], runtime),
    ).resolves.toBe(6)
    expect(calls).toHaveLength(1)
    expect(sleeps).toEqual([])
  })

  it('reads T212_MAX_RETRIES and lets --max-retries win', async () => {
    const fromEnv = setup([tooManyRequests(), tooManyRequests(), { body: {} }], {
      T212_MAX_RETRIES: '1',
    })
    await expect(runCli(summary, fromEnv.runtime)).resolves.toBe(6)
    expect(fromEnv.calls).toHaveLength(2)

    const fromFlag = setup([tooManyRequests(), tooManyRequests(), { body: {} }], {
      T212_MAX_RETRIES: '0',
    })
    await expect(
      runCli(['node', 't212', '--max-retries', '2', ...summary.slice(2)], fromFlag.runtime),
    ).resolves.toBe(0)
    expect(fromFlag.calls).toHaveLength(3)
  })

  it('rejects invalid max retries with exit code 2 before network I/O', async () => {
    for (const [args, env] of [
      [['--max-retries', '-1'], {}],
      [['--max-retries', '1.5'], {}],
      [['--max-retries', 'many'], {}],
      [[], { T212_MAX_RETRIES: 'abc' }],
    ] as const) {
      const { runtime, calls, stderr } = setup([{ body: {} }], env)

      await expect(runCli(['node', 't212', ...args, ...summary.slice(2)], runtime)).resolves.toBe(2)
      expect(calls).toHaveLength(0)
      expect(stderr.value).toContain('Invalid max retries')
    }
  })
})

describe('never retrying writes', () => {
  it('fails a 429 POST immediately with exit code 6', async () => {
    const { runtime, sleeps, calls, stderr } = setup([tooManyRequests(), { body: { id: 1 } }])

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
    ).resolves.toBe(6)

    expect(calls).toHaveLength(1)
    expect(sleeps).toEqual([])
    expect(stderr.value).toContain('rate limit exceeded')
    expect(stderr.value).not.toContain('retrying')
  })

  it('fails a 429 DELETE immediately with exit code 6', async () => {
    const { runtime, sleeps, calls } = setup([tooManyRequests(), { body: {} }])

    await expect(
      runCli(['node', 't212', 'orders', 'cancel', '42', '--yes'], runtime),
    ).resolves.toBe(6)
    expect(calls).toHaveLength(1)
    expect(sleeps).toEqual([])
  })
})

describe('rate_limited error details', () => {
  it('includes status, body, parsed headers and the retry count', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const { fetch: baseFetch } = createSequenceFetch([
      tooManyRequests(),
      tooManyRequests(quotaHeaders(0)),
    ])
    const wrapped = createRateLimitedFetch({
      fetch: baseFetch,
      maxRetries: 1,
      output: 'json',
      rateLimitInfo: false,
      sleep: async () => {},
      stderr: new BufferWriter(),
    })
    const response = await wrapped('https://demo.trading212.com/api/v0/equity/account/summary')

    expect(() => unwrapApiResponse({ error: { code: 'TooManyRequests' }, response }, null)).toThrow(
      expect.objectContaining({
        code: 'rate_limited',
        exitCode: 6,
        details: {
          status: 429,
          statusText: 'Error',
          body: { code: 'TooManyRequests' },
          rateLimit: { limit: 6, period: 60, remaining: 0, reset: nowSeconds + 30, used: 6 },
          retries: 1,
        },
      }),
    )
  })
})

describe('--rate-limit-info', () => {
  it('reports the quota of every attempt, including the final 429, when retries run out', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const { runtime, stdout, stderr } = setup([
      tooManyRequests(quotaHeaders(0, nowSeconds - 1)),
      tooManyRequests(quotaHeaders(0, nowSeconds - 1)),
    ])

    await expect(
      runCli(
        ['node', 't212', '--rate-limit-info', '--max-retries', '1', ...summary.slice(2)],
        runtime,
      ),
    ).resolves.toBe(6)

    expect(stdout.value).toBe('')
    const rawLines = stderr.value.trimEnd().split('\n')
    expect(rawLines).toHaveLength(4)
    expect(rawLines.map((line) => JSON.parse(line) as unknown)).toEqual([
      { rateLimit: expect.objectContaining({ remaining: 0, limit: 6 }) },
      { retry: expect.objectContaining({ attempt: 1, maxRetries: 1, waitMs: 1_000 }) },
      { rateLimit: expect.objectContaining({ remaining: 0, limit: 6 }) },
      {
        error: expect.objectContaining({
          code: 'rate_limited',
          exitCode: 6,
          details: expect.objectContaining({ retries: 1 }),
        }),
      },
    ])
  })

  it('writes one JSON line per response to stderr and leaves stdout untouched', async () => {
    const plain = setup([{ body: { currency: 'GBP' }, headers: quotaHeaders(5) }])
    await expect(runCli(summary, plain.runtime)).resolves.toBe(0)

    const { runtime, stdout, stderr } = setup([
      { body: { currency: 'GBP' }, headers: quotaHeaders(5) },
    ])
    await expect(
      runCli(['node', 't212', '--rate-limit-info', ...summary.slice(2)], runtime),
    ).resolves.toBe(0)

    expect(stdout.value).toBe(plain.stdout.value)
    expect(plain.stderr.value).toBe('')
    expect(stderr.value.trim().split('\n')).toHaveLength(1)
    expect(stderrJsonLines(stderr.value)).toEqual([
      {
        rateLimit: {
          limit: 6,
          period: 60,
          remaining: 5,
          reset: nowSeconds + 30,
          used: 1,
          endpoint: 'GET /api/v0/equity/account/summary',
        },
      },
    ])
  })

  it('omits the query string from the endpoint', async () => {
    const { runtime, stderr } = setup([{ body: { items: [] }, headers: quotaHeaders(5) }], {
      T212_RATE_LIMIT_INFO: 'true',
    })

    await expect(
      runCli(['node', 't212', 'history', 'orders', '--limit', '5'], runtime),
    ).resolves.toBe(0)
    expect(stderrJsonLines(stderr.value)).toEqual([
      { rateLimit: expect.objectContaining({ endpoint: 'GET /api/v0/equity/history/orders' }) },
    ])
  })

  it('rejects an invalid T212_RATE_LIMIT_INFO value with exit code 2', async () => {
    const { runtime, stderr, calls } = setup([{ body: {} }], { T212_RATE_LIMIT_INFO: 'maybe' })

    await expect(runCli(summary, runtime)).resolves.toBe(2)
    expect(calls).toHaveLength(0)
    expect(stderr.value).toContain('Invalid T212_RATE_LIMIT_INFO value')
  })

  it('reads T212_RATE_LIMIT_INFO and writes JSON retry notices', async () => {
    const { runtime, stdout, stderr } = setup(
      [tooManyRequests(quotaHeaders(0, nowSeconds + 41)), { body: {}, headers: quotaHeaders(5) }],
      { T212_RATE_LIMIT_INFO: 'true' },
    )

    await expect(runCli(summary, runtime)).resolves.toBe(0)

    expect(JSON.parse(stdout.value)).toEqual({})
    expect(stderrJsonLines(stderr.value)).toEqual([
      { rateLimit: expect.objectContaining({ remaining: 0 }) },
      {
        retry: {
          attempt: 1,
          maxRetries: 3,
          waitMs: 42_000,
          endpoint: 'GET /api/v0/equity/account/summary',
        },
      },
      { rateLimit: expect.objectContaining({ remaining: 5 }) },
    ])
  })

  it('writes human-readable lines in pretty mode', async () => {
    const { runtime, stderr } = setup([{ body: {}, headers: quotaHeaders(5) }])

    await expect(
      runCli(
        ['node', 't212', '--output', 'pretty', '--rate-limit-info', ...summary.slice(2)],
        runtime,
      ),
    ).resolves.toBe(0)

    expect(stderr.value).toBe(
      `Rate limit: 5/6 remaining per 60s, resets ${new Date((nowSeconds + 30) * 1000).toISOString()} (GET /api/v0/equity/account/summary)\n`,
    )
  })
})

describe('retry notices', () => {
  it('prints a retry notice in pretty mode even without --rate-limit-info', async () => {
    const { runtime, stderr } = setup([
      tooManyRequests(quotaHeaders(0, nowSeconds + 41)),
      { body: {} },
    ])

    await expect(
      runCli(['node', 't212', '--output', 'pretty', ...summary.slice(2)], runtime),
    ).resolves.toBe(0)
    expect(stderr.value).toBe(
      'Rate limited; retrying in 42s (1/3) for GET /api/v0/equity/account/summary\n',
    )
  })

  it('prints nothing on stderr in JSON mode without --rate-limit-info', async () => {
    const { runtime, stderr } = setup([tooManyRequests({ 'retry-after': '1' }), { body: {} }])

    await expect(runCli(summary, runtime)).resolves.toBe(0)
    expect(stderr.value).toBe('')
  })
})

describe('runtime config for rate limiting', () => {
  it('defaults to 3 retries with rate limit info disabled', () => {
    const { runtime } = createTestRuntime()

    expect(resolveRuntimeConfig({ optsWithGlobals: () => ({}) }, runtime)).toMatchObject({
      maxRetries: 3,
      rateLimitInfo: false,
    })
  })

  it('lets --rate-limit-info win over T212_RATE_LIMIT_INFO=false', () => {
    const { runtime } = createTestRuntime({ env: { T212_RATE_LIMIT_INFO: 'false' } })

    expect(
      resolveRuntimeConfig({ optsWithGlobals: () => ({ rateLimitInfo: true }) }, runtime),
    ).toMatchObject({ rateLimitInfo: true })
  })
})
