import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'
import { confirm, input, password } from '@inquirer/prompts'
import { KeyringSecretStore } from './auth/keyring-store.ts'
import { runPromptUntilInputEnds } from './runtime-prompts.ts'
import { createGuardedWritable } from './output/guarded-stream.ts'

export type WritableLike = {
  /**
   * Implementations must invoke `callback` once the chunk has been handed off (as Node
   * streams do), because streaming output awaits it for backpressure.
   */
  write(chunk: string, callback?: (error?: Error | null) => void): unknown
}

export type ReadableLike = {
  readonly isTTY?: boolean
}

export type PromptAdapter = {
  confirm(options: { default?: boolean; message: string }): Promise<boolean>
  input(options: { message: string }): Promise<string>
  password(options: { mask?: string; message: string }): Promise<string>
}

export type Runtime = {
  env: NodeJS.ProcessEnv
  fetch: typeof fetch
  prompts: PromptAdapter
  secretStore: import('./auth/secret-store.ts').SecretStore
  sleep(milliseconds: number): Promise<void>
  stderr: WritableLike
  stdin: ReadableLike
  stdout: WritableLike
  /**
   * First error reported by the real stdout stream (for example `EPIPE` once the reader has
   * gone away), so `runCli` can still act on failures from writes nobody awaited.
   */
  stdoutFailure?(): Error | undefined
}

export function createDefaultRuntime(): Runtime {
  // Guarding both streams means a closed pipe (EPIPE) can never crash the process with an
  // uncaught 'error' event. stderr errors have nowhere to be reported, so they are dropped.
  const stdout = createGuardedWritable(process.stdout)
  const stderr = createGuardedWritable(process.stderr)

  return {
    env: process.env,
    fetch: globalThis.fetch,
    prompts: {
      confirm: (options) =>
        runPromptUntilInputEnds(process.stdin, (signal) => confirm(options, { signal })),
      input: (options) =>
        runPromptUntilInputEnds(process.stdin, (signal) => input(options, { signal })),
      password: (options) =>
        runPromptUntilInputEnds(process.stdin, (signal) => password(options, { signal })),
    },
    secretStore: new KeyringSecretStore(),
    sleep: async (milliseconds) => {
      await delay(milliseconds)
    },
    stderr,
    stdin: process.stdin,
    stdout,
    stdoutFailure: stdout.failure,
  }
}
