import type { SecretStore } from '../src/auth/secret-store.ts'
import type { PromptAdapter, Runtime, WritableLike } from '../src/runtime.ts'

export class BufferWriter implements WritableLike {
  value = ''

  write(chunk: string): boolean {
    this.value += chunk
    return true
  }
}

export class MemorySecretStore implements SecretStore {
  readonly values = new Map<string, string>()

  async delete(account: string): Promise<boolean> {
    return this.values.delete(account)
  }

  async get(account: string): Promise<string | null> {
    return this.values.get(account) ?? null
  }

  async set(account: string, secret: string): Promise<void> {
    this.values.set(account, secret)
  }
}

export type FetchCall = {
  init: Parameters<typeof fetch>[1]
  input: Parameters<typeof fetch>[0]
}

export type TestRuntime = {
  fetchCalls: FetchCall[]
  runtime: Runtime
  stderr: BufferWriter
  stdout: BufferWriter
  store: MemorySecretStore
}

export function createJsonFetch(
  responseBody: unknown,
  status = 200,
): {
  calls: FetchCall[]
  fetch: typeof fetch
} {
  const calls: FetchCall[] = []
  const fetchMock: typeof fetch = async (input, init) => {
    calls.push({ input, init })

    return new Response(JSON.stringify(responseBody), {
      headers: {
        'content-type': 'application/json',
      },
      status,
      statusText: status >= 400 ? 'Error' : 'OK',
    })
  }

  return {
    calls,
    fetch: fetchMock,
  }
}

export function createTestRuntime(
  options: {
    env?: NodeJS.ProcessEnv
    fetch?: typeof fetch
    isTTY?: boolean
    prompts?: Partial<PromptAdapter>
  } = {},
): TestRuntime {
  const stdout = new BufferWriter()
  const stderr = new BufferWriter()
  const store = new MemorySecretStore()
  const fetchSetup = createJsonFetch({})
  const fetchMock = options.fetch ?? fetchSetup.fetch
  const stdin = options.isTTY === undefined ? {} : { isTTY: options.isTTY }

  return {
    fetchCalls: fetchSetup.calls,
    runtime: {
      env: options.env ?? {},
      fetch: fetchMock,
      prompts: {
        confirm: options.prompts?.confirm ?? (async () => false),
        input: options.prompts?.input ?? (async () => ''),
        password: options.prompts?.password ?? (async () => ''),
      },
      secretStore: store,
      stderr,
      stdin,
      stdout,
    },
    stderr,
    stdout,
    store,
  }
}

export function getFetchUrl(call: FetchCall): string {
  return call.input instanceof Request ? call.input.url : String(call.input)
}

export function getRequestHeader(call: FetchCall, name: string): string | null {
  if (call.input instanceof Request) {
    return call.input.headers.get(name)
  }

  const headers = call.init?.headers

  if (headers === undefined) {
    return null
  }

  return new Headers(headers).get(name)
}

export async function getRequestJsonBody(call: FetchCall): Promise<unknown> {
  if (call.input instanceof Request) {
    return call.input.clone().json()
  }

  const body = call.init?.body

  if (typeof body !== 'string') {
    return null
  }

  return JSON.parse(body)
}
