import { Command } from '@commander-js/extra-typings'
import { parseIsoDate, parseLimit, parsePositiveInteger } from '../cli/parsers.ts'
import { type OutputFormat, resolveRuntimeConfig } from '../config/runtime-config.ts'
import { CliError } from '../errors.ts'
import type { paths } from '../generated/trading212.ts'
import { type ApiResult, unwrapApiResponse } from '../http/client.ts'
import {
  iteratePages,
  type PageQuery,
  type PaginatedPage,
  parseNextPageQuery,
} from '../http/pagination.ts'
import { isJsonOutput, writeNdjsonItemsAsync, writeResult } from '../output/format.ts'
import type { Runtime } from '../runtime.ts'
import { type ApiContext, createReadContext, createWriteContext } from './context.ts'
import { createExportsDownloadCommand } from './export-download.ts'

type PaginationOptions = {
  all?: boolean
  nextPagePath?: string
  progress?: boolean
}

type CursorLimitTickerOptions = PaginationOptions & {
  cursor?: number
  limit?: number
  ticker?: string
}

type TransactionsOptions = PaginationOptions & {
  cursor?: string
  limit?: number
  time?: string
}

type DividendsQuery = NonNullable<
  paths['/api/v0/equity/history/dividends']['get']['parameters']['query']
>
type HistoricalOrdersQuery = NonNullable<
  paths['/api/v0/equity/history/orders']['get']['parameters']['query']
>
type TransactionsQuery = NonNullable<
  paths['/api/v0/equity/history/transactions']['get']['parameters']['query']
>

const allPagesDescription =
  'Follow nextPagePath until the last page and print all items: one JSON array, or one item per line streamed as each page arrives with --output ndjson. Uses --limit 50 unless set; waits for the rate limit to reset when needed'
const progressDescription =
  'After each fetched page, write a progress line to stderr with the page number, item counts, and nextPagePath. To resume an interrupted --all run from it, use --output ndjson: other formats print nothing until the last page'
function nextPagePathDescription(conflictingFlags: readonly string[]): string {
  const flags = conflictingFlags.join(', ')
  return `Start from a nextPagePath printed by a previous run. Must point at this endpoint in the selected environment; cannot be combined with ${flags}`
}

type ExportRequestOptions = {
  from: string
  includeDividends?: boolean
  includeInterest?: boolean
  includeOrders?: boolean
  includeTransactions?: boolean
  to: string
  yes?: boolean
}

export function createHistoryCommand(runtime: Runtime): Command {
  const history = new Command('history').description(
    'Read account history and request CSV exports.',
  )

  history.addCommand(createDividendsCommand(runtime))
  history.addCommand(createHistoricalOrdersCommand(runtime))
  history.addCommand(createTransactionsCommand(runtime))
  history.addCommand(createExportsCommand(runtime))

  return history
}

function createDividendsCommand(runtime: Runtime): Command {
  const dividends = new Command('dividends')
    .description('Get paid out dividends.')
    .option('--ticker <ticker>', 'Instrument ticker filter')
    .option('--cursor <cursor>', 'Pagination cursor', parsePositiveInteger)
    .option('--limit <number>', 'Page size, max 50', parseLimit)
    .option('--all', allPagesDescription)
    .option('--progress', progressDescription)
    .option('--next-page-path <path>', nextPagePathDescription(['--ticker', '--cursor', '--limit']))

  dividends.action(async () => {
    const options = dividends.opts() as CursorLimitTickerOptions

    await runPaginatedHistory({
      command: dividends,
      endpointPath: '/api/v0/equity/history/dividends',
      fetchPage: (context, pageQuery) =>
        context.client.GET('/api/v0/equity/history/dividends', {
          params: {
            query: pageQuery as DividendsQuery,
          },
        }),
      options,
      query: definedEntries({
        cursor: options.cursor,
        limit: options.limit,
        ticker: options.ticker,
      }),
      runtime,
    })
  })

  return dividends
}

function createHistoricalOrdersCommand(runtime: Runtime): Command {
  const orders = new Command('orders')
    .description('Get historical orders.')
    .option('--ticker <ticker>', 'Instrument ticker filter')
    .option('--cursor <cursor>', 'Pagination cursor', parsePositiveInteger)
    .option('--limit <number>', 'Page size, max 50', parseLimit)
    .option('--all', allPagesDescription)
    .option('--progress', progressDescription)
    .option('--next-page-path <path>', nextPagePathDescription(['--ticker', '--cursor', '--limit']))

  orders.action(async () => {
    const options = orders.opts() as CursorLimitTickerOptions

    await runPaginatedHistory({
      command: orders,
      endpointPath: '/api/v0/equity/history/orders',
      fetchPage: (context, pageQuery) =>
        context.client.GET('/api/v0/equity/history/orders', {
          params: {
            query: pageQuery as HistoricalOrdersQuery,
          },
        }),
      options,
      query: definedEntries({
        cursor: options.cursor,
        limit: options.limit,
        ticker: options.ticker,
      }),
      runtime,
    })
  })

  return orders
}

function createTransactionsCommand(runtime: Runtime): Command {
  const transactions = new Command('transactions')
    .description('Get account cash transactions.')
    .option('--cursor <cursor>', 'Pagination cursor')
    .option(
      '--time <iso-date>',
      'Retrieve transactions starting from this ISO date-time',
      parseIsoDate,
    )
    .option('--limit <number>', 'Page size, max 50', parseLimit)
    .option('--all', allPagesDescription)
    .option('--progress', progressDescription)
    .option('--next-page-path <path>', nextPagePathDescription(['--cursor', '--time', '--limit']))

  transactions.action(async () => {
    const options = transactions.opts() as TransactionsOptions

    await runPaginatedHistory({
      command: transactions,
      endpointPath: '/api/v0/equity/history/transactions',
      fetchPage: (context, pageQuery) =>
        context.client.GET('/api/v0/equity/history/transactions', {
          params: {
            query: pageQuery as TransactionsQuery,
          },
        }),
      options,
      query: definedEntries({
        cursor: options.cursor,
        limit: options.limit,
        time: options.time,
      }),
      runtime,
    })
  })

  return transactions
}

type PaginatedHistoryRequest<T> = {
  command: Command
  endpointPath: string
  fetchPage(context: ApiContext, query: PageQuery): Promise<ApiResult<PaginatedPage<T>>>
  options: PaginationOptions
  /**
   * Query built from the user's flags (without the --all default page size). Each key maps
   * to the `--<key>` flag, and any of them conflicts with --next-page-path.
   */
  query: PageQuery
  runtime: Runtime
}

type ProgressLine = {
  items: number
  nextPagePath: string | null
  page: number
  total: number
}

async function runPaginatedHistory<T>(request: PaginatedHistoryRequest<T>): Promise<void> {
  const { options, runtime } = request
  const startPath = options.nextPagePath
  let initialQuery: PageQuery

  if (startPath !== undefined) {
    const conflicting = Object.keys(request.query).map((key) => `--${key}`)

    if (conflicting.length > 0) {
      throw new CliError(
        `--next-page-path cannot be combined with ${conflicting.join(', ')}; the path already encodes its query`,
        { code: 'conflicting_options', exitCode: 2 },
      )
    }

    // Validate before resolving credentials so a foreign URL never sees an auth header.
    const { baseUrl, environment } = resolveRuntimeConfig(request.command, runtime)
    initialQuery = parseStartPath(startPath, {
      baseUrl,
      endpointPath: request.endpointPath,
      environment,
    })
  } else {
    initialQuery = options.all === true ? { limit: 50, ...request.query } : request.query
  }

  const context = await createReadContext(request.command, runtime)
  const format = context.config.output
  const fetchPage = (query: PageQuery) => request.fetchPage(context, query)

  if (options.all !== true) {
    const result = await fetchPage(initialQuery)
    const page = unwrapApiResponse(result, null)

    // Results first, then progress, so a progress cursor never points past unwritten items.
    writeResult(runtime, format, page)

    if (options.progress === true) {
      const items = page?.items?.length ?? 0
      writeProgress(runtime, format, {
        items,
        nextPagePath: normalizeNextPagePath(page?.nextPagePath),
        page: 1,
        total: items,
      })
    }

    return
  }

  const pages = iteratePages({
    baseUrl: context.config.baseUrl,
    endpointPath: request.endpointPath,
    fetchPage,
    initialQuery,
    runtime,
  })
  const collected: T[] = []
  let total = 0

  for await (const chunk of pages) {
    total += chunk.items.length

    if (format === 'ndjson') {
      // Wait for stdout to accept the page before reporting progress or fetching more.
      await writeNdjsonItemsAsync(runtime, chunk.items)
    } else {
      collected.push(...chunk.items)
    }

    if (options.progress === true) {
      writeProgress(runtime, format, {
        items: chunk.items.length,
        nextPagePath: chunk.nextPagePath,
        page: chunk.page,
        total,
      })
    }
  }

  if (format !== 'ndjson') {
    writeResult(runtime, format, collected)
  }
}

function parseStartPath(
  path: string,
  target: { baseUrl: string; endpointPath: string; environment: string },
): PageQuery {
  try {
    return parseNextPageQuery(path, target.baseUrl, target.endpointPath)
  } catch {
    throw new CliError(
      `Invalid --next-page-path for the ${target.environment} environment (${target.baseUrl}): expected a path on ${target.endpointPath}`,
      { code: 'invalid_next_page_path', exitCode: 2 },
    )
  }
}

function writeProgress(runtime: Runtime, format: OutputFormat, progress: ProgressLine): void {
  if (isJsonOutput(format)) {
    runtime.stderr.write(`${JSON.stringify({ progress })}\n`)
    return
  }

  const next = progress.nextPagePath === null ? 'last page' : `next: ${progress.nextPagePath}`
  runtime.stderr.write(
    `Page ${progress.page}: ${progress.items} items (${progress.total} total), ${next}\n`,
  )
}

function normalizeNextPagePath(value: string | null | undefined): string | null {
  return value === undefined || value === null || value === '' ? null : value
}

function definedEntries(values: Record<string, string | number | undefined>): PageQuery {
  const query: PageQuery = {}

  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) {
      query[key] = value
    }
  }

  return query
}

function createExportsCommand(runtime: Runtime): Command {
  const exports = new Command('exports').description('Manage asynchronous CSV report exports.')

  const list = new Command('list').description('List requested CSV reports and statuses.')
  list.action(async () => {
    const context = await createReadContext(list, runtime)
    const result = await context.client.GET('/api/v0/equity/history/exports')
    writeResult(runtime, context.config.output, unwrapApiResponse(result, []))
  })

  const request = new Command('request')
    .description('Request a CSV report. Write action; blocked by read-only mode.')
    .requiredOption('--from <iso-date>', 'Start ISO date-time', parseIsoDate)
    .requiredOption('--to <iso-date>', 'End ISO date-time', parseIsoDate)
    .option('--include-dividends', 'Include dividends in the report')
    .option('--include-interest', 'Include interest in the report')
    .option('--include-orders', 'Include orders in the report')
    .option('--include-transactions', 'Include transactions in the report')
    .option('--yes', 'Confirm report request without an interactive prompt')

  request.action(async () => {
    const options = request.opts() as ExportRequestOptions
    const context = await createWriteContext(request, runtime, {
      action: 'request a CSV history export',
      yes: options.yes,
    })
    const hasAnyIncludeFlag =
      options.includeDividends === true ||
      options.includeInterest === true ||
      options.includeOrders === true ||
      options.includeTransactions === true
    const dataIncluded = hasAnyIncludeFlag
      ? {
          includeDividends: options.includeDividends === true,
          includeInterest: options.includeInterest === true,
          includeOrders: options.includeOrders === true,
          includeTransactions: options.includeTransactions === true,
        }
      : {
          includeDividends: true,
          includeInterest: true,
          includeOrders: true,
          includeTransactions: true,
        }

    const result = await context.client.POST('/api/v0/equity/history/exports', {
      body: {
        dataIncluded,
        timeFrom: options.from,
        timeTo: options.to,
      },
    })

    writeResult(runtime, context.config.output, unwrapApiResponse(result, null))
  })

  exports.addCommand(list)
  exports.addCommand(request)
  exports.addCommand(createExportsDownloadCommand(runtime))

  return exports
}
