import createClient from 'openapi-fetch'
import { createAuthorizationHeader, type Credentials } from '../auth/credentials.ts'
import type { RuntimeConfig } from '../config/runtime-config.ts'
import { CliError } from '../errors.ts'
import type { paths } from '../generated/trading212.ts'
import type { Runtime } from '../runtime.ts'

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
    fetch: runtime.fetch,
    headers: {
      Authorization: createAuthorizationHeader(credentials),
    },
  })
}

export function unwrapApiResponse<T>(result: ApiResult<T>, fallbackData: T): T {
  if (!result.response.ok || result.error !== undefined) {
    throw new CliError(
      `Trading 212 API request failed with HTTP ${result.response.status} ${result.response.statusText}`.trim(),
      {
        code: 'api_error',
        details: result.error,
        exitCode: apiExitCode(result.response.status),
      },
    )
  }

  return result.data ?? fallbackData
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
