import { Command } from '@commander-js/extra-typings'
import { unwrapApiResponse } from '../http/client.ts'
import { writeResult } from '../output/format.ts'
import type { Runtime } from '../runtime.ts'
import { createReadContext } from './context.ts'

export function createAccountCommand(runtime: Runtime): Command {
  const account = new Command('account').description('Access Trading 212 account information.')

  const summary = new Command('summary').description('Get account summary, cash, and total value.')
  summary.action(async () => {
    const context = await createReadContext(summary, runtime)
    const result = await context.client.GET('/api/v0/equity/account/summary')
    writeResult(runtime, context.config.output, unwrapApiResponse(result, null))
  })

  account.addCommand(summary)
  return account
}
