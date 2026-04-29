import process from 'node:process'
import { confirm, input, password } from '@inquirer/prompts'
import { KeyringSecretStore } from './auth/keyring-store.ts'

export type WritableLike = {
  write(chunk: string): unknown
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
  stderr: WritableLike
  stdin: ReadableLike
  stdout: WritableLike
}

export function createDefaultRuntime(): Runtime {
  return {
    env: process.env,
    fetch: globalThis.fetch,
    prompts: {
      confirm,
      input,
      password,
    },
    secretStore: new KeyringSecretStore(),
    stderr: process.stderr,
    stdin: process.stdin,
    stdout: process.stdout,
  }
}
