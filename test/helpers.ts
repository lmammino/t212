import type { SecretStore } from '../src/auth/secret-store.ts'
import type { PromptAdapter, Runtime, WritableLike } from '../src/runtime.ts'

export class BufferWriter implements WritableLike {
  readonly chunks: Uint8Array[] = []

  get bytes(): Buffer {
    return Buffer.concat(this.chunks)
  }

  get value(): string {
    return this.bytes.toString('utf8')
  }

  write(chunk: string | Uint8Array, callback?: (error?: Error | null) => void): boolean {
    this.chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : Buffer.from(chunk))
    callback?.()
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
  sleeps: number[]
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
    cwd?: string
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
  const sleeps: number[] = []

  return {
    fetchCalls: fetchSetup.calls,
    runtime: {
      cwd: () => options.cwd ?? process.cwd(),
      env: options.env ?? {},
      fetch: fetchMock,
      prompts: {
        confirm: options.prompts?.confirm ?? (async () => false),
        input: options.prompts?.input ?? (async () => ''),
        password: options.prompts?.password ?? (async () => ''),
      },
      secretStore: store,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds)
      },
      stderr,
      stdin,
      stdout,
    },
    sleeps,
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

export type MockResponse = {
  body: unknown
  headers?: Record<string, string>
  status?: number
}

export function createSequenceFetch(responses: MockResponse[]): {
  calls: FetchCall[]
  fetch: typeof fetch
} {
  const calls: FetchCall[] = []
  const fetchMock: typeof fetch = async (input, init) => {
    const response = responses[calls.length]
    calls.push({ input, init })

    if (response === undefined) {
      throw new Error(`Unexpected fetch call #${calls.length}`)
    }

    const status = response.status ?? 200

    return new Response(JSON.stringify(response.body), {
      headers: {
        'content-type': 'application/json',
        ...response.headers,
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
