import { CliError } from '../errors.ts'
import type { Runtime } from '../runtime.ts'
import { type ApiResult, unwrapApiResponse } from './client.ts'

export type PaginatedPage<T> = {
  items?: T[]
  nextPagePath?: string | null
}

export type PageQuery = Record<string, string | number>

export type FetchAllPagesOptions<T> = {
  baseUrl: string
  endpointPath: string
  fetchPage(query: PageQuery): Promise<ApiResult<PaginatedPage<T>>>
  initialQuery: PageQuery
  runtime: Runtime
}

// Upper bound so a misbehaving API cannot keep the CLI paginating forever.
const maxPages = 10_000
const rateLimitBufferMilliseconds = 1_000

/**
 * Follows `nextPagePath` until it is null and returns every item from every page.
 *
 * Only `nextPagePath` values pointing at the same origin and endpoint are followed, so
 * credentials are never sent elsewhere. When the rate-limit headers say the quota is
 * exhausted, waits until `x-ratelimit-reset` before requesting the next page.
 */
export async function fetchAllPages<T>(options: FetchAllPagesOptions<T>): Promise<T[]> {
  const items: T[] = []
  const seenPaths = new Set<string>()
  let query: PageQuery | undefined = options.initialQuery

  for (let page = 0; query !== undefined; page++) {
    if (page >= maxPages) {
      throw new CliError(`Pagination stopped after ${maxPages} pages`, {
        code: 'pagination_limit_exceeded',
      })
    }

    const result = await options.fetchPage(query)
    const data = unwrapApiResponse(result, {})
    items.push(...(data.items ?? []))

    const nextPagePath = data.nextPagePath

    if (nextPagePath === undefined || nextPagePath === null || nextPagePath === '') {
      query = undefined
      continue
    }

    if (seenPaths.has(nextPagePath)) {
      throw new CliError('Pagination returned a nextPagePath that was already requested', {
        code: 'pagination_loop',
        details: { nextPagePath },
      })
    }

    seenPaths.add(nextPagePath)
    query = parseNextPageQuery(nextPagePath, options.baseUrl, options.endpointPath)

    await waitForRateLimit(options.runtime, result.response)
  }

  return items
}

export function parseNextPageQuery(
  nextPagePath: string,
  baseUrl: string,
  endpointPath: string,
): PageQuery {
  const base = new URL(baseUrl)
  let next: URL

  try {
    next = new URL(nextPagePath, base)
  } catch {
    throw invalidNextPagePath(nextPagePath)
  }

  if (next.origin !== base.origin || next.pathname !== endpointPath) {
    throw invalidNextPagePath(nextPagePath)
  }

  return Object.fromEntries(next.searchParams)
}

async function waitForRateLimit(runtime: Runtime, response: Response): Promise<void> {
  const remaining = Number(response.headers.get('x-ratelimit-remaining') ?? Number.NaN)
  const reset = Number(response.headers.get('x-ratelimit-reset') ?? Number.NaN)

  if (!Number.isFinite(remaining) || remaining > 0 || !Number.isFinite(reset)) {
    return
  }

  const waitMilliseconds = reset * 1000 - Date.now() + rateLimitBufferMilliseconds

  if (waitMilliseconds > 0) {
    await runtime.sleep(waitMilliseconds)
  }
}

function invalidNextPagePath(nextPagePath: string): CliError {
  return new CliError('Trading 212 API returned an unexpected nextPagePath', {
    code: 'invalid_next_page_path',
    details: { nextPagePath },
  })
}
