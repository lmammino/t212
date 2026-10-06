import { inspect } from 'node:util'
import type { OutputFormat } from '../config/runtime-config.ts'
import {
  CliError,
  type ErrorEnvelope,
  isBrokenPipeError,
  OutputClosedError,
  toErrorEnvelope,
  toOutputWriteError,
} from '../errors.ts'
import type { Runtime, WritableLike } from '../runtime.ts'

/** True for every machine-readable output format, i.e. anything other than `pretty`. */
export function isJsonOutput(format: OutputFormat): boolean {
  return format !== 'pretty'
}

export function writeResult(runtime: Runtime, format: OutputFormat, data: unknown): void {
  const value = data ?? null

  // Exhaustive on purpose: a new output format must decide how results are rendered here
  // (and stay consistent with `isJsonOutput`) instead of silently falling through.
  switch (format) {
    case 'json':
      runtime.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
      return
    case 'json-compact':
      runtime.stdout.write(`${JSON.stringify(value)}\n`)
      return
    case 'ndjson':
      if (Array.isArray(value)) {
        writeNdjsonItems(runtime, value)
      } else {
        runtime.stdout.write(`${JSON.stringify(value)}\n`)
      }
      return
    case 'pretty':
      runtime.stdout.write(
        `${inspect(value, { colors: runtime.stdin.isTTY === true, depth: null })}\n`,
      )
      return
    default: {
      const unsupported: never = format
      throw new CliError(`Unsupported output format: ${String(unsupported)}`, {
        code: 'invalid_output_format',
        exitCode: 2,
      })
    }
  }
}

function formatNdjsonItems(items: readonly unknown[]): string {
  return items.map((item) => `${JSON.stringify(item ?? null)}\n`).join('')
}

/** Writes one compact JSON line per item. Writes nothing for an empty array. */
function writeNdjsonItems(runtime: Runtime, items: readonly unknown[]): void {
  if (items.length > 0) {
    runtime.stdout.write(formatNdjsonItems(items))
  }
}

/**
 * Like `writeNdjsonItems`, but resolves only once stdout has accepted the chunk, so
 * streaming callers apply backpressure and never report progress past undelivered output.
 */
export async function writeNdjsonItemsAsync(
  runtime: Runtime,
  items: readonly unknown[],
): Promise<void> {
  if (items.length > 0) {
    await writeAndWait(runtime.stdout, formatNdjsonItems(items))
  }
}

function writeAndWait(stream: WritableLike, chunk: string): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.write(chunk, (error) => {
      if (error) {
        reject(isBrokenPipeError(error) ? new OutputClosedError() : toOutputWriteError(error))
      } else {
        resolve()
      }
    })
  })
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
