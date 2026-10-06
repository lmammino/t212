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
  /** First page's query. It counts as already requested for loop detection. */
  initialQuery: PageQuery
  runtime: Runtime
}

export type PageChunk<T> = {
  items: T[]
  nextPagePath: string | null
  /** 1-based page number within this run. */
  page: number
}

// Upper bound so a misbehaving API cannot keep the CLI paginating forever.
const maxPages = 10_000
const rateLimitBufferMilliseconds = 1_000

/**
 * Follows `nextPagePath` until it is null, yielding each page as soon as it arrives.
 *
 * Only `nextPagePath` values pointing at the same origin and endpoint are followed, so
 * credentials are never sent elsewhere. When the rate-limit headers say the quota is
 * exhausted, waits until `x-ratelimit-reset` before requesting the next page. Each page is
 * yielded before the next one is validated or awaited, so consumers can flush output early.
 */
export async function* iteratePages<T>(
  options: FetchAllPagesOptions<T>,
): AsyncGenerator<PageChunk<T>, void, undefined> {
  // Keyed by canonical query (the endpoint is fixed), so absolute/relative paths and
  // reordered query parameters for the same page are recognised as the same request.
  const seenQueries = new Set<string>([pageQueryKey(options.initialQuery)])
  let query: PageQuery | undefined = options.initialQuery

  for (let page = 0; query !== undefined; page++) {
    if (page >= maxPages) {
      throw new CliError(`Pagination stopped after ${maxPages} pages`, {
        code: 'pagination_limit_exceeded',
      })
    }

    const result = await options.fetchPage(query)
    const data = unwrapApiResponse(result, {})
    const rawNextPagePath = data.nextPagePath
    const nextPagePath =
      rawNextPagePath === undefined || rawNextPagePath === null || rawNextPagePath === ''
        ? null
        : rawNextPagePath

    yield { items: data.items ?? [], nextPagePath, page: page + 1 }

    if (nextPagePath === null) {
      query = undefined
      continue
    }

    query = parseNextPageQuery(nextPagePath, options.baseUrl, options.endpointPath)
    const key = pageQueryKey(query)

    if (seenQueries.has(key)) {
      throw new CliError('Pagination returned a nextPagePath that was already requested', {
        code: 'pagination_loop',
        details: { nextPagePath },
      })
    }

    seenQueries.add(key)

    await waitForRateLimit(options.runtime, result.response)
  }
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

function pageQueryKey(query: PageQuery): string {
  return JSON.stringify(
    Object.entries(query)
      .map(([key, value]): [string, string] => [key, String(value)])
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  )
}

function invalidNextPagePath(nextPagePath: string): CliError {
  return new CliError('Trading 212 API returned an unexpected nextPagePath', {
    code: 'invalid_next_page_path',
    details: { nextPagePath },
  })
}
