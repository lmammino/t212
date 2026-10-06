import createClient from 'openapi-fetch'
import { createAuthorizationHeader, type Credentials } from '../auth/credentials.ts'
import type { RuntimeConfig } from '../config/runtime-config.ts'
import { CliError } from '../errors.ts'
import type { paths } from '../generated/trading212.ts'
import type { Runtime } from '../runtime.ts'
import { createRateLimitedFetch, getRetryCount, parseRateLimitHeaders } from './rate-limit.ts'

export type Trading212Client = ReturnType<typeof createClient<paths>>

export type ApiResult<T> = {
  data?: T
  error?: unknown
  response: Response
}

export function createTrading212Client(
  runtime: Runtime,
  config: RuntimeConfig,
  credentials: Credentials,
): Trading212Client {
  return createClient<paths>({
    baseUrl: config.baseUrl,
    fetch: createRateLimitedFetch({
      fetch: runtime.fetch,
      maxRetries: config.maxRetries,
      output: config.output,
      rateLimitInfo: config.rateLimitInfo,
      sleep: (milliseconds) => runtime.sleep(milliseconds),
      stderr: runtime.stderr,
    }),
    headers: {
      Authorization: createAuthorizationHeader(credentials),
    },
  })
}

export function unwrapApiResponse<T>(result: ApiResult<T>, fallbackData: T): T {
  if (result.response.status === 429) {
    throw rateLimitedError(result)
  }

  if (!result.response.ok || result.error !== undefined) {
    throw new CliError(
      `Trading 212 API request failed with HTTP ${result.response.status} ${result.response.statusText}`.trim(),
      {
        code: 'api_error',
        details: {
          status: result.response.status,
          statusText: result.response.statusText,
          body: result.error ?? null,
        },
        exitCode: apiExitCode(result.response.status),
      },
    )
  }

  return result.data ?? fallbackData
}

function rateLimitedError(result: ApiResult<unknown>): CliError {
  const { response } = result
  const retries = getRetryCount(response)
  const suffix = retries === 0 ? '' : ` after ${retries} ${retries === 1 ? 'retry' : 'retries'}`
  const status = `HTTP ${response.status} ${response.statusText}`.trim()

  return new CliError(`Trading 212 API rate limit exceeded (${status})${suffix}`, {
    code: 'rate_limited',
    details: {
      status: response.status,
      statusText: response.statusText,
      body: result.error ?? null,
      rateLimit: parseRateLimitHeaders(response.headers),
      retries,
    },
    exitCode: 6,
  })
}

function apiExitCode(status: number): number {
  if (status === 401 || status === 403) {
    return 4
  }

  if (status === 404) {
    return 5
  }

  return 1
}
