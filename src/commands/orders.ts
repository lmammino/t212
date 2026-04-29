import { Command } from '@commander-js/extra-typings'
import { unwrapApiResponse } from '../http/client.ts'
import { writeResult } from '../output/format.ts'
import type { Runtime } from '../runtime.ts'
import { parseInteger, parseNumberOption, parseTimeValidity } from '../cli/parsers.ts'
import { createReadContext, createWriteContext } from './context.ts'

type YesOption = {
  yes?: boolean
}

type MarketOrderOptions = YesOption & {
  extendedHours?: boolean
  quantity: number
  ticker: string
}

type LimitOrderOptions = YesOption & {
  limitPrice: number
  quantity: number
  ticker: string
  timeValidity?: 'DAY' | 'GOOD_TILL_CANCEL'
}

type StopOrderOptions = YesOption & {
  quantity: number
  stopPrice: number
  ticker: string
  timeValidity?: 'DAY' | 'GOOD_TILL_CANCEL'
}

type StopLimitOrderOptions = LimitOrderOptions & {
  stopPrice: number
}

export function createOrdersCommand(runtime: Runtime): Command {
  const orders = new Command('orders').description('Place, inspect, and cancel equity orders.')

  const list = new Command('list').description('List all pending orders.')
  list.action(async () => {
    const context = await createReadContext(list, runtime)
    const result = await context.client.GET('/api/v0/equity/orders')
    writeResult(runtime, context.config.output, unwrapApiResponse(result, []))
  })

  const get = new Command('get')
    .description('Get a pending order by ID.')
    .argument('<id>', 'Pending order ID', parseInteger)

  get.action(async (id) => {
    const context = await createReadContext(get, runtime)
    const result = await context.client.GET('/api/v0/equity/orders/{id}', {
      params: {
        path: {
          id,
        },
      },
    })

    writeResult(runtime, context.config.output, unwrapApiResponse(result, null))
  })

  const cancel = new Command('cancel')
    .description('Cancel a pending order. Write action; blocked by read-only mode.')
    .argument('<id>', 'Pending order ID', parseInteger)
    .option('--yes', 'Confirm the cancellation without an interactive prompt')

  cancel.action(async (id) => {
    const options = cancel.opts() as YesOption
    const context = await createWriteContext(cancel, runtime, {
      action: `cancel order ${id}`,
      yes: options.yes,
    })
    const result = await context.client.DELETE('/api/v0/equity/orders/{id}', {
      params: {
        path: {
          id,
        },
      },
    })

    unwrapApiResponse(result, null)
    writeResult(runtime, context.config.output, { canceled: true, id })
  })

  orders.addCommand(list)
  orders.addCommand(get)
  orders.addCommand(cancel)
  orders.addCommand(createPlaceOrderCommand(runtime))

  return orders
}

function createPlaceOrderCommand(runtime: Runtime): Command {
  const place = new Command('place').description(
    'Place equity orders. Write actions require --yes.',
  )

  const market = new Command('market')
    .description('Place a market order. Positive quantity buys; negative quantity sells.')
    .requiredOption('--ticker <ticker>', 'Instrument ticker, for example AAPL_US_EQ')
    .requiredOption(
      '--quantity <number>',
      'Share quantity. Use negative values to sell.',
      parseNumberOption,
    )
    .option('--extended-hours', 'Allow execution outside regular trading hours')
    .option('--yes', 'Confirm order placement without an interactive prompt')

  market.action(async () => {
    const options = market.opts() as MarketOrderOptions
    const context = await createWriteContext(market, runtime, {
      action: `place market order for ${options.ticker}`,
      yes: options.yes,
    })
    const result = await context.client.POST('/api/v0/equity/orders/market', {
      body: {
        extendedHours: options.extendedHours === true,
        quantity: options.quantity,
        ticker: options.ticker,
      },
    })

    writeResult(runtime, context.config.output, unwrapApiResponse(result, null))
  })

  const limit = new Command('limit')
    .description('Place a limit order. Positive quantity buys; negative quantity sells.')
    .requiredOption('--ticker <ticker>', 'Instrument ticker, for example AAPL_US_EQ')
    .requiredOption(
      '--quantity <number>',
      'Share quantity. Use negative values to sell.',
      parseNumberOption,
    )
    .requiredOption('--limit-price <number>', 'Limit price', parseNumberOption)
    .option('--time-validity <value>', 'DAY or GOOD_TILL_CANCEL', parseTimeValidity)
    .option('--yes', 'Confirm order placement without an interactive prompt')

  limit.action(async () => {
    const options = limit.opts() as LimitOrderOptions
    const context = await createWriteContext(limit, runtime, {
      action: `place limit order for ${options.ticker}`,
      yes: options.yes,
    })
    const body: {
      limitPrice: number
      quantity: number
      ticker: string
      timeValidity?: 'DAY' | 'GOOD_TILL_CANCEL'
    } = {
      limitPrice: options.limitPrice,
      quantity: options.quantity,
      ticker: options.ticker,
    }

    if (options.timeValidity !== undefined) {
      body.timeValidity = options.timeValidity
    }

    const result = await context.client.POST('/api/v0/equity/orders/limit', {
      body,
    })

    writeResult(runtime, context.config.output, unwrapApiResponse(result, null))
  })

  const stop = new Command('stop')
    .description('Place a stop order. Positive quantity buys; negative quantity sells.')
    .requiredOption('--ticker <ticker>', 'Instrument ticker, for example AAPL_US_EQ')
    .requiredOption(
      '--quantity <number>',
      'Share quantity. Use negative values to sell.',
      parseNumberOption,
    )
    .requiredOption('--stop-price <number>', 'Stop trigger price', parseNumberOption)
    .option('--time-validity <value>', 'DAY or GOOD_TILL_CANCEL', parseTimeValidity)
    .option('--yes', 'Confirm order placement without an interactive prompt')

  stop.action(async () => {
    const options = stop.opts() as StopOrderOptions
    const context = await createWriteContext(stop, runtime, {
      action: `place stop order for ${options.ticker}`,
      yes: options.yes,
    })
    const body: {
      quantity: number
      stopPrice: number
      ticker: string
      timeValidity?: 'DAY' | 'GOOD_TILL_CANCEL'
    } = {
      quantity: options.quantity,
      stopPrice: options.stopPrice,
      ticker: options.ticker,
    }

    if (options.timeValidity !== undefined) {
      body.timeValidity = options.timeValidity
    }

    const result = await context.client.POST('/api/v0/equity/orders/stop', {
      body,
    })

    writeResult(runtime, context.config.output, unwrapApiResponse(result, null))
  })

  const stopLimit = new Command('stop-limit')
    .description('Place a stop-limit order. Positive quantity buys; negative quantity sells.')
    .requiredOption('--ticker <ticker>', 'Instrument ticker, for example AAPL_US_EQ')
    .requiredOption(
      '--quantity <number>',
      'Share quantity. Use negative values to sell.',
      parseNumberOption,
    )
    .requiredOption('--stop-price <number>', 'Stop trigger price', parseNumberOption)
    .requiredOption('--limit-price <number>', 'Limit price after stop trigger', parseNumberOption)
    .option('--time-validity <value>', 'DAY or GOOD_TILL_CANCEL', parseTimeValidity)
    .option('--yes', 'Confirm order placement without an interactive prompt')

  stopLimit.action(async () => {
    const options = stopLimit.opts() as StopLimitOrderOptions
    const context = await createWriteContext(stopLimit, runtime, {
      action: `place stop-limit order for ${options.ticker}`,
      yes: options.yes,
    })
    const body: {
      limitPrice: number
      quantity: number
      stopPrice: number
      ticker: string
      timeValidity?: 'DAY' | 'GOOD_TILL_CANCEL'
    } = {
      limitPrice: options.limitPrice,
      quantity: options.quantity,
      stopPrice: options.stopPrice,
      ticker: options.ticker,
    }

    if (options.timeValidity !== undefined) {
      body.timeValidity = options.timeValidity
    }

    const result = await context.client.POST('/api/v0/equity/orders/stop_limit', {
      body,
    })

    writeResult(runtime, context.config.output, unwrapApiResponse(result, null))
  })

  place.addCommand(market)
  place.addCommand(limit)
  place.addCommand(stop)
  place.addCommand(stopLimit)

  return place
}
