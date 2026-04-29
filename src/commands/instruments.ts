import { Command } from '@commander-js/extra-typings'
import { unwrapApiResponse } from '../http/client.ts'
import { writeResult } from '../output/format.ts'
import type { Runtime } from '../runtime.ts'
import { createReadContext } from './context.ts'

export function createInstrumentsCommand(runtime: Runtime): Command {
  const instruments = new Command('instruments').description('Discover tradable instruments.')

  const list = new Command('list').description('List all available instruments.')
  list.action(async () => {
    const context = await createReadContext(list, runtime)
    const result = await context.client.GET('/api/v0/equity/metadata/instruments')
    writeResult(runtime, context.config.output, unwrapApiResponse(result, []))
  })

  instruments.addCommand(list)
  return instruments
}

export function createExchangesCommand(runtime: Runtime): Command {
  const exchanges = new Command('exchanges').description('Discover Trading 212 exchange metadata.')

  const list = new Command('list').description('List exchanges and working schedules.')
  list.action(async () => {
    const context = await createReadContext(list, runtime)
    const result = await context.client.GET('/api/v0/equity/metadata/exchanges')
    writeResult(runtime, context.config.output, unwrapApiResponse(result, []))
  })

  exchanges.addCommand(list)
  return exchanges
}
