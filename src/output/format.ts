import { inspect } from 'node:util'
import type { OutputFormat } from '../config/runtime-config.ts'
import { type ErrorEnvelope, toErrorEnvelope } from '../errors.ts'
import type { Runtime } from '../runtime.ts'

/** True for every machine-readable output format, i.e. anything other than `pretty`. */
export function isJsonOutput(format: OutputFormat): boolean {
  return format !== 'pretty'
}

export function writeResult(runtime: Runtime, format: OutputFormat, data: unknown): void {
  if (format === 'json') {
    runtime.stdout.write(`${JSON.stringify(data ?? null, null, 2)}\n`)
    return
  }

  runtime.stdout.write(
    `${inspect(data ?? null, { colors: runtime.stdin.isTTY === true, depth: null })}\n`,
  )
}

export function writeMessage(runtime: Runtime, message: string): void {
  runtime.stdout.write(`${message}\n`)
}

/**
 * Writes an error to stderr. In JSON output modes this is exactly one line containing the
 * envelope `{"error":{"code","message","exitCode","details"}}`; in pretty mode it is the
 * human-readable `Error: <message>` line.
 */
export function writeError(runtime: Runtime, format: OutputFormat, error: unknown): void {
  const envelope = toErrorEnvelope(error)

  if (!isJsonOutput(format)) {
    runtime.stderr.write(`Error: ${envelope.error.message}\n`)
    return
  }

  runtime.stderr.write(`${serializeErrorEnvelope(envelope)}\n`)
}

function serializeErrorEnvelope(envelope: ErrorEnvelope): string {
  try {
    return JSON.stringify(envelope)
  } catch {
    // Details that cannot be serialized (cycles, BigInt) must not hide the error itself.
    return JSON.stringify({ error: { ...envelope.error, details: null } })
  }
}
