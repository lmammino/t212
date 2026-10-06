import type { OutputFormat } from '../config/runtime-config.ts'
import { isJsonOutput } from '../output/format.ts'
import type { Runtime } from '../runtime.ts'

/** Values of the `x-ratelimit-*` headers Trading 212 sends on every response. */
export type RateLimitInfo = {
  limit: number | null
  period: number | null
  remaining: number | null
  reset: number | null
  used: number | null
}

/** Upper bound on the total time a single request may spend waiting between retries. */
export const maxCumulativeRetryWaitMilliseconds = 120_000

const resetBufferMilliseconds = 1_000
const minimumResetWaitMilliseconds = 1_000
const backoffBaseMilliseconds = 1_000
const backoffJitterRatio = 0.2

const retryCounts = new WeakMap<Response, number>()

export function parseRateLimitHeaders(headers: Headers): RateLimitInfo {
  return {
    limit: numericHeader(headers, 'x-ratelimit-limit'),
    period: numericHeader(headers, 'x-ratelimit-period'),
    remaining: numericHeader(headers, 'x-ratelimit-remaining'),
    reset: numericHeader(headers, 'x-ratelimit-reset'),
    used: numericHeader(headers, 'x-ratelimit-used'),
  }
}

/**
 * Milliseconds until `x-ratelimit-reset` (a Unix timestamp in seconds) has passed, plus a
 * small buffer. The result can be zero or negative when the reset time is already past.
 */
export function millisecondsUntilReset(reset: number, now: number): number {
  return reset * 1000 - now + resetBufferMilliseconds
}

/** Parses a `Retry-After` header given either as delta seconds or as an HTTP-date. */
export function parseRetryAfter(value: string | null, now: number): number | undefined {
  if (value === null || value.trim() === '') {
    return undefined
  }

  const trimmed = value.trim()

  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return Number(trimmed) * 1000
  }

  const date = Date.parse(trimmed)

  if (Number.isNaN(date)) {
    return undefined
  }

  return Math.max(0, date - now)
}

export type RetryWaitOptions = {
  /** Zero-based index of the retry about to happen. */
  attempt: number
  headers: Headers
  now: number
  random: () => number
}

/**
 * How long to wait before retrying a rate-limited request, in priority order:
 * `x-ratelimit-reset` (at least 1s), then `Retry-After` (at least 1s), then exponential backoff
 * (1s, 2s, 4s, ...) with ±20% jitter.
 */
export function computeRetryWait(options: RetryWaitOptions): number {
  const reset = numericHeader(options.headers, 'x-ratelimit-reset')

  if (reset !== null) {
    const wait = millisecondsUntilReset(reset, options.now)
    return Math.round(wait > 0 ? wait : minimumResetWaitMilliseconds)
  }

  const retryAfter = parseRetryAfter(options.headers.get('retry-after'), options.now)

  if (retryAfter !== undefined) {
    // Floor at 1s like the reset path: `Retry-After: 0` or a past date must not turn the
    // retry loop into back-to-back requests that never consume the wait budget.
    return Math.max(minimumResetWaitMilliseconds, Math.round(retryAfter))
  }

  const base = backoffBaseMilliseconds * 2 ** options.attempt
  const jitter = 1 - backoffJitterRatio + options.random() * backoffJitterRatio * 2

  return Math.round(base * jitter)
}

/**
 * Waits until `x-ratelimit-reset` when a response reports that no quota is left. Used
 * proactively between pages, so it never waits when the reset time is already past.
 */
export async function waitForQuotaReset(runtime: Runtime, response: Response): Promise<void> {
  const { remaining, reset } = parseRateLimitHeaders(response.headers)

  if (remaining === null || remaining > 0 || reset === null) {
    return
  }

  const waitMilliseconds = millisecondsUntilReset(reset, Date.now())

  if (waitMilliseconds > 0) {
    await runtime.sleep(waitMilliseconds)
  }
}

/** Number of retries the rate-limited fetch performed before returning this response. */
export function getRetryCount(response: Response): number {
  return retryCounts.get(response) ?? 0
}

export type RateLimitedFetchOptions = {
  fetch: typeof fetch
  maxRetries: number
  output: OutputFormat
  random?: () => number
  rateLimitInfo: boolean
  sleep(milliseconds: number): Promise<void>
  stderr: Runtime['stderr']
}

/**
 * Wraps `fetch` so HTTP 429 responses to GET/HEAD requests are retried. Write requests are
 * never retried: their 429 response is returned as is. Returns the last 429 response once
 * retries are exhausted or the next wait would exceed the cumulative wait cap.
 */
export function createRateLimitedFetch(options: RateLimitedFetchOptions): typeof fetch {
  const random = options.random ?? Math.random

  return async (input, init) => {
    const request =
      input instanceof Request && init === undefined ? input : new Request(input, init)
    const method = request.method.toUpperCase()
    const retryable = method === 'GET' || method === 'HEAD'
    const endpoint = `${method} ${new URL(request.url).pathname}`
    let retries = 0
    let waited = 0

    while (true) {
      const response = await options.fetch(retryable ? request.clone() : request)
      retryCounts.set(response, retries)
      reportRateLimit(options, response, endpoint)

      if (response.status !== 429 || !retryable || retries >= options.maxRetries) {
        return response
      }

      const waitMilliseconds = computeRetryWait({
        attempt: retries,
        headers: response.headers,
        now: Date.now(),
        random,
      })

      if (waited + waitMilliseconds > maxCumulativeRetryWaitMilliseconds) {
        return response
      }

      reportRetry(options, { attempt: retries + 1, endpoint, waitMilliseconds })
      try {
        await response.body?.cancel()
      } catch {
        // Discarding the 429 body is only cleanup; an already-errored stream must not
        // abort the retry.
      }
      await options.sleep(waitMilliseconds)
      waited += waitMilliseconds
      retries++
    }
  }
}

function reportRateLimit(
  options: RateLimitedFetchOptions,
  response: Response,
  endpoint: string,
): void {
  if (!options.rateLimitInfo) {
    return
  }

  const info = parseRateLimitHeaders(response.headers)

  if (isJsonOutput(options.output)) {
    options.stderr.write(`${JSON.stringify({ rateLimit: { ...info, endpoint } })}\n`)
    return
  }

  const remaining =
    info.remaining === null
      ? 'unknown'
      : `${info.remaining}/${info.limit === null ? '?' : info.limit}`
  const period = info.period === null ? '' : ` per ${info.period}s`
  const reset = info.reset === null ? '' : `, resets ${formatReset(info.reset)}`

  options.stderr.write(`Rate limit: ${remaining} remaining${period}${reset} (${endpoint})\n`)
}

function reportRetry(
  options: RateLimitedFetchOptions,
  retry: { attempt: number; endpoint: string; waitMilliseconds: number },
): void {
  if (isJsonOutput(options.output)) {
    if (options.rateLimitInfo) {
      options.stderr.write(
        `${JSON.stringify({
          retry: {
            attempt: retry.attempt,
            maxRetries: options.maxRetries,
            waitMs: retry.waitMilliseconds,
            endpoint: retry.endpoint,
          },
        })}\n`,
      )
    }

    return
  }

  const seconds = Math.ceil(retry.waitMilliseconds / 1000)
  options.stderr.write(
    `Rate limited; retrying in ${seconds}s (${retry.attempt}/${options.maxRetries}) for ${retry.endpoint}\n`,
  )
}

function formatReset(reset: number): string {
  const date = new Date(reset * 1000)
  return Number.isNaN(date.getTime()) ? String(reset) : date.toISOString()
}

function numericHeader(headers: Headers, name: string): number | null {
  const value = headers.get(name)

  if (value === null || value.trim() === '') {
    return null
  }

  const parsed = Number(value)

  return Number.isFinite(parsed) ? parsed : null
}
