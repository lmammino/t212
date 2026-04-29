import { Command } from '@commander-js/extra-typings'
import { parseInteger, parseJsonObject } from '../cli/parsers.ts'
import { unwrapApiResponse } from '../http/client.ts'
import { writeResult } from '../output/format.ts'
import type { Runtime } from '../runtime.ts'
import { createReadContext, createWriteContext } from './context.ts'

type YesOption = {
  yes?: boolean
}

type BodyOption = YesOption & {
  body: Record<string, unknown>
}

type DuplicateOptions = YesOption & {
  icon?: string
  name: string
}

export function createPiesCommand(runtime: Runtime): Command {
  const pies = new Command('pies').description(
    'Deprecated Trading 212 pie endpoints. Prefer current API surfaces where possible.',
  )

  const list = new Command('list').description('[Deprecated] List pies.')
  list.action(async () => {
    const context = await createReadContext(list, runtime)
    const result = await context.client.GET('/api/v0/equity/pies')
    writeResult(runtime, context.config.output, unwrapApiResponse(result, []))
  })

  const get = new Command('get')
    .description('[Deprecated] Get a pie by ID.')
    .argument('<id>', 'Pie ID', parseInteger)

  get.action(async (id) => {
    const context = await createReadContext(get, runtime)
    const result = await context.client.GET('/api/v0/equity/pies/{id}', {
      params: {
        path: {
          id,
        },
      },
    })

    writeResult(runtime, context.config.output, unwrapApiResponse(result, null))
  })

  const create = new Command('create')
    .description('[Deprecated] Create a pie from a PieRequest JSON object.')
    .requiredOption('--body <json>', 'PieRequest JSON object', parseJsonObject)
    .option('--yes', 'Confirm pie creation without an interactive prompt')

  create.action(async () => {
    const options = create.opts() as BodyOption
    const context = await createWriteContext(create, runtime, {
      action: 'create a pie',
      yes: options.yes,
    })
    const result = await context.client.POST('/api/v0/equity/pies', {
      body: options.body,
    })

    writeResult(runtime, context.config.output, unwrapApiResponse(result, null))
  })

  const update = new Command('update')
    .description('[Deprecated] Update a pie from a PieRequest JSON object.')
    .argument('<id>', 'Pie ID', parseInteger)
    .requiredOption('--body <json>', 'PieRequest JSON object', parseJsonObject)
    .option('--yes', 'Confirm pie update without an interactive prompt')

  update.action(async (id) => {
    const options = update.opts() as BodyOption
    const context = await createWriteContext(update, runtime, {
      action: `update pie ${id}`,
      yes: options.yes,
    })
    const result = await context.client.POST('/api/v0/equity/pies/{id}', {
      body: options.body,
      params: {
        path: {
          id,
        },
      },
    })

    writeResult(runtime, context.config.output, unwrapApiResponse(result, null))
  })

  const duplicate = new Command('duplicate')
    .description('[Deprecated] Duplicate a pie.')
    .argument('<id>', 'Pie ID', parseInteger)
    .requiredOption('--name <name>', 'Name for the duplicated pie')
    .option('--icon <icon>', 'Icon for the duplicated pie')
    .option('--yes', 'Confirm pie duplication without an interactive prompt')

  duplicate.action(async (id) => {
    const options = duplicate.opts() as DuplicateOptions
    const context = await createWriteContext(duplicate, runtime, {
      action: `duplicate pie ${id}`,
      yes: options.yes,
    })
    const body: {
      icon?: string
      name: string
    } = {
      name: options.name,
    }

    if (options.icon !== undefined) {
      body.icon = options.icon
    }

    const result = await context.client.POST('/api/v0/equity/pies/{id}/duplicate', {
      body,
      params: {
        path: {
          id,
        },
      },
    })

    writeResult(runtime, context.config.output, unwrapApiResponse(result, null))
  })

  const deleteCommand = new Command('delete')
    .description('[Deprecated] Delete a pie. Write action; blocked by read-only mode.')
    .argument('<id>', 'Pie ID', parseInteger)
    .option('--yes', 'Confirm pie deletion without an interactive prompt')

  deleteCommand.action(async (id) => {
    const options = deleteCommand.opts() as YesOption
    const context = await createWriteContext(deleteCommand, runtime, {
      action: `delete pie ${id}`,
      yes: options.yes,
    })
    const result = await context.client.DELETE('/api/v0/equity/pies/{id}', {
      params: {
        path: {
          id,
        },
      },
    })

    unwrapApiResponse(result, null)
    writeResult(runtime, context.config.output, { deleted: true, id })
  })

  pies.addCommand(list)
  pies.addCommand(get)
  pies.addCommand(create)
  pies.addCommand(update)
  pies.addCommand(duplicate)
  pies.addCommand(deleteCommand)

  return pies
}
