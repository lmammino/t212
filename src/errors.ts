export type CliErrorOptions = {
  /** Stable, machine-readable error code emitted in the JSON error envelope. */
  code: string
  details?: unknown
  exitCode?: number
}

export class CliError extends Error {
  readonly code: string
  readonly details: unknown
  readonly exitCode: number

  constructor(message: string, options: CliErrorOptions) {
    super(message)
    this.name = 'CliError'
    this.code = options.code
    this.details = options.details
    this.exitCode = options.exitCode ?? 1
  }
}

export type ErrorEnvelope = {
  error: {
    code: string
    message: string
    exitCode: number
    details: unknown
  }
}

/**
 * Converts any thrown value into the structured error envelope printed on stderr in JSON
 * output mode. Errors that are not `CliError` become `internal_error` with exit code 1.
 */
export function toErrorEnvelope(error: unknown): ErrorEnvelope {
  if (error instanceof CliError) {
    return {
      error: {
        code: error.code,
        message: error.message,
        exitCode: error.exitCode,
        details: error.details ?? null,
      },
    }
  }

  return {
    error: {
      code: 'internal_error',
      message: toErrorMessage(error),
      exitCode: 1,
      details: null,
    },
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
