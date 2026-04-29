export type CliErrorOptions = {
  code?: string
  details?: unknown
  exitCode?: number
}

export class CliError extends Error {
  readonly code: string | undefined
  readonly details: unknown
  readonly exitCode: number

  constructor(message: string, options: CliErrorOptions = {}) {
    super(message)
    this.name = 'CliError'
    this.code = options.code
    this.details = options.details
    this.exitCode = options.exitCode ?? 1
  }
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  if (typeof error === 'string') {
    return error
  }

  return 'Unknown error'
}
