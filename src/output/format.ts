import { inspect } from 'node:util'
import type { OutputFormat } from '../config/runtime-config.ts'
import type { Runtime } from '../runtime.ts'

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

export function writeError(runtime: Runtime, message: string): void {
  runtime.stderr.write(`Error: ${message}\n`)
}
