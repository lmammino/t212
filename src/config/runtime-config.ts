import { CliError } from '../errors.ts'
import type { Runtime } from '../runtime.ts'

export const environments = ['demo', 'live'] as const
export const outputFormats = ['json', 'pretty'] as const

export type TradingEnvironment = (typeof environments)[number]
export type OutputFormat = (typeof outputFormats)[number]

export type RuntimeConfig = {
  baseUrl: string
  environment: TradingEnvironment
  output: OutputFormat
  readOnly: boolean
}

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
  const output = parseOutputFormat(stringOption(options.output) ?? 'json')
  const readOnly =
    booleanOption(options.readOnly) ?? parseBooleanEnv(runtime.env.T212_READ_ONLY) ?? false

  return {
    baseUrl: environment === 'demo' ? 'https://demo.trading212.com' : 'https://live.trading212.com',
    environment,
    output,
    readOnly,
  }
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

  throw new CliError(`Invalid output format "${value}". Expected json or pretty.`, {
    code: 'invalid_output_format',
    exitCode: 2,
  })
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
