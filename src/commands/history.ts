import { Command } from '@commander-js/extra-typings'
import { parseIsoDate, parseLimit, parsePositiveInteger } from '../cli/parsers.ts'
import { unwrapApiResponse } from '../http/client.ts'
import { writeResult } from '../output/format.ts'
import type { Runtime } from '../runtime.ts'
import { createReadContext, createWriteContext } from './context.ts'

type CursorLimitTickerOptions = {
  cursor?: number
  limit?: number
  ticker?: string
}

type TransactionsOptions = {
  cursor?: string
  limit?: number
  time?: string
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

  dividends.action(async () => {
    const context = await createReadContext(dividends, runtime)
    const options = dividends.opts() as CursorLimitTickerOptions
    const query: {
      cursor?: number
      limit?: number
      ticker?: string
    } = {}

    if (options.cursor !== undefined) {
      query.cursor = options.cursor
    }

    if (options.limit !== undefined) {
      query.limit = options.limit
    }

    if (options.ticker !== undefined) {
      query.ticker = options.ticker
    }

    const result = await context.client.GET('/api/v0/equity/history/dividends', {
      params: {
        query,
      },
    })

    writeResult(runtime, context.config.output, unwrapApiResponse(result, null))
  })

  return dividends
}

function createHistoricalOrdersCommand(runtime: Runtime): Command {
  const orders = new Command('orders')
    .description('Get historical orders.')
    .option('--ticker <ticker>', 'Instrument ticker filter')
    .option('--cursor <cursor>', 'Pagination cursor', parsePositiveInteger)
    .option('--limit <number>', 'Page size, max 50', parseLimit)

  orders.action(async () => {
    const context = await createReadContext(orders, runtime)
    const options = orders.opts() as CursorLimitTickerOptions
    const query: {
      cursor?: number
      limit?: number
      ticker?: string
    } = {}

    if (options.cursor !== undefined) {
      query.cursor = options.cursor
    }

    if (options.limit !== undefined) {
      query.limit = options.limit
    }

    if (options.ticker !== undefined) {
      query.ticker = options.ticker
    }

    const result = await context.client.GET('/api/v0/equity/history/orders', {
      params: {
        query,
      },
    })

    writeResult(runtime, context.config.output, unwrapApiResponse(result, null))
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

  transactions.action(async () => {
    const context = await createReadContext(transactions, runtime)
    const options = transactions.opts() as TransactionsOptions
    const query: {
      cursor?: string
      limit?: number
      time?: string
    } = {}

    if (options.cursor !== undefined) {
      query.cursor = options.cursor
    }

    if (options.limit !== undefined) {
      query.limit = options.limit
    }

    if (options.time !== undefined) {
      query.time = options.time
    }

    const result = await context.client.GET('/api/v0/equity/history/transactions', {
      params: {
        query,
      },
    })

    writeResult(runtime, context.config.output, unwrapApiResponse(result, null))
  })

  return transactions
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

  return exports
}
