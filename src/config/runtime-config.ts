import { CliError } from '../errors.ts'
import type { Runtime } from '../runtime.ts'

export const environments = ['demo', 'live'] as const
export const outputFormats = ['json', 'json-compact', 'ndjson', 'pretty'] as const

export type TradingEnvironment = (typeof environments)[number]
export type OutputFormat = (typeof outputFormats)[number]

export type RuntimeConfig = {
  baseUrl: string
  environment: TradingEnvironment
  output: OutputFormat
  readOnly: boolean
}

export const defaultOutputFormat: OutputFormat = 'json'

export type CommandWithGlobalOptions = {
  optsWithGlobals(): Record<string, unknown>
}

export function resolveRuntimeConfig(
  command: CommandWithGlobalOptions,
  runtime: Runtime,
): RuntimeConfig {
  const options = command.optsWithGlobals()
  const environment = parseEnvironment(
    stringOption(options.environment) ?? runtime.env.T212_ENVIRONMENT ?? 'live',
  )
  const output = parseOutputFormat(stringOption(options.output) ?? defaultOutputFormat)
  const readOnly =
    booleanOption(options.readOnly) ?? parseBooleanEnv(runtime.env.T212_READ_ONLY) ?? false

  return {
    baseUrl: environment === 'demo' ? 'https://demo.trading212.com' : 'https://live.trading212.com',
    environment,
    output,
    readOnly,
  }
}

/**
 * Determines the output format straight from argv, before Commander parses anything, so
 * errors raised before `resolveRuntimeConfig` runs (usage errors, invalid environment)
 * can still be emitted in the right format.
 *
 * Mirrors `resolveRuntimeConfig`: the last `--output <format>` / `--output=<format>` wins
 * and the default is JSON. Unlike `resolveRuntimeConfig` it never throws: a missing or
 * invalid value falls back to the default (JSON) so the resulting error stays parseable.
 */
export function detectOutputFormat(argv: readonly string[]): OutputFormat {
  let value: string | undefined
  // argv[0] is the Node binary and argv[1] the script, matching Commander's default parsing.
  const args = argv.slice(2)

  for (let index = 0; index < args.length; index++) {
    const arg = args[index]

    if (arg === '--') {
      break
    }

    if (arg === '--output') {
      value = args[index + 1]
      index++
    } else if (arg?.startsWith('--output=')) {
      value = arg.slice('--output='.length)
    }
  }

  const format = stringOption(value)
  return format !== undefined && isOutputFormat(format) ? format : defaultOutputFormat
}

export function parseEnvironment(value: string): TradingEnvironment {
  if (isTradingEnvironment(value)) {
    return value
  }

  throw new CliError(`Invalid environment "${value}". Expected demo or live.`, {
    code: 'invalid_environment',
    exitCode: 2,
  })
}

export function parseOutputFormat(value: string): OutputFormat {
  if (isOutputFormat(value)) {
    return value
  }

  throw new CliError(
    `Invalid output format "${value}". Expected one of: ${outputFormats.join(', ')}.`,
    {
      code: 'invalid_output_format',
      exitCode: 2,
    },
  )
}

export function parseBooleanEnv(value: string | undefined): boolean | undefined {
  if (value === undefined) {
    return undefined
  }

  const normalized = value.trim().toLowerCase()

  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) {
    return true
  }

  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) {
    return false
  }

  throw new CliError(`Invalid T212_READ_ONLY value "${value}". Expected true or false.`, {
    code: 'invalid_read_only_env',
    exitCode: 2,
  })
}

function isTradingEnvironment(value: string): value is TradingEnvironment {
  return environments.includes(value as TradingEnvironment)
}

function isOutputFormat(value: string): value is OutputFormat {
  return outputFormats.includes(value as OutputFormat)
}

function stringOption(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function booleanOption(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}
