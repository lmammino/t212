import { Command } from '@commander-js/extra-typings'
import { unwrapApiResponse } from '../http/client.ts'
import { writeResult } from '../output/format.ts'
import type { Runtime } from '../runtime.ts'
import { createReadContext } from './context.ts'

type PositionListOptions = {
  ticker?: string
}

export function createPositionsCommand(runtime: Runtime): Command {
  const positions = new Command('positions').description('Inspect open portfolio positions.')

  const list = new Command('list')
    .description('List open positions, optionally filtered by ticker.')
    .option('--ticker <ticker>', 'Instrument ticker, for example AAPL_US_EQ')

  list.action(async () => {
    const context = await createReadContext(list, runtime)
    const options = list.opts() as PositionListOptions
    const query: { ticker?: string } = {}

    if (options.ticker !== undefined) {
      query.ticker = options.ticker
    }

    const result = await context.client.GET('/api/v0/equity/positions', {
      params: {
        query,
      },
    })

    writeResult(runtime, context.config.output, unwrapApiResponse(result, []))
  })

  positions.addCommand(list)
  return positions
}
