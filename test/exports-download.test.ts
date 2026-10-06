import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createCli } from '../src/cli/app.ts'
import { runCli } from '../src/cli/run.ts'
import { createTestRuntime, type FetchCall, getFetchUrl, getRequestHeader } from './helpers.ts'

const credentials = {
  T212_API_KEY: 'key',
  T212_API_SECRET: 'secret',
}

const downloadLink =
  'https://reports.example-bucket.test/exports/42.csv?X-Amz-Signature=supersecretsignature'
const csvBytes = new Uint8Array([
  ...new TextEncoder().encode('Action,Time,ISIN\nMarket buy,2026-01-02,US0378331005\n'),
  0xef,
  0xbb,
  0xbf,
  0x00,
  0xff,
])

type DownloadResponse = {
  body?: ConstructorParameters<typeof Response>[0]
  status?: number
  statusText?: string
}

function setup(
  options: {
    download?: DownloadResponse
    env?: NodeJS.ProcessEnv
    exportsRateLimited?: number
    redirects?: Record<string, string>
    reports?: unknown[]
  } = {},
) {
  const calls: FetchCall[] = []
  const reports = options.reports ?? [
    { reportId: 7, status: 'Processing' },
    { downloadLink, reportId: 42, status: 'Finished' },
  ]
  let listCalls = 0
  const fetchMock: typeof fetch = async (input, init) => {
    calls.push({ init, input })
    const url = getFetchUrl({ init, input })
    const location = options.redirects?.[url]

    if (location !== undefined) {
      return new Response(null, { headers: { location }, status: 302, statusText: 'Found' })
    }

    if (url.startsWith('https://reports.example-bucket.test/')) {
      const download = options.download ?? {}
      return new Response(download.body === undefined ? csvBytes : download.body, {
        status: download.status ?? 200,
        statusText: download.statusText ?? 'OK',
      })
    }

    if (listCalls++ < (options.exportsRateLimited ?? 0)) {
      return new Response(JSON.stringify({ message: 'Limited' }), {
        headers: { 'content-type': 'application/json', 'retry-after': '1' },
        status: 429,
        statusText: 'Too Many Requests',
      })
    }

    return new Response(JSON.stringify(reports), {
      headers: { 'content-type': 'application/json' },
      status: 200,
      statusText: 'OK',
    })
  }
  const testRuntime = createTestRuntime({
    cwd: workDir,
    env: options.env ?? credentials,
    fetch: fetchMock,
  })

  return { ...testRuntime, calls }
}

let workDir = ''

beforeEach(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), 't212-download-test-'))
})

afterEach(async () => {
  await rm(workDir, { force: true, recursive: true })
})

describe('history exports download', () => {
  it('documents the command, --file, --file - and --force in help', () => {
    const { runtime } = createTestRuntime()
    const history = createCli(runtime).commands.find((command) => command.name() === 'history')
    const exportsCommand = history?.commands.find((command) => command.name() === 'exports')
    const download = exportsCommand?.commands.find((command) => command.name() === 'download')
    const help = download?.helpInformation() ?? ''

    expect(help).toContain('<reportId>')
    expect(help).toContain('Read action')
    expect(help).toContain('--file <path>')
    expect(help).toContain('--file -')
    expect(help).toContain('not --output')
    expect(help).toContain('--force')
  })

  it('downloads a finished report to the default path and prints metadata', async () => {
    const { runtime, stdout, stderr, calls } = setup()

    await expect(
      runCli(['node', 't212', 'history', 'exports', 'download', '42'], runtime),
    ).resolves.toBe(0)

    const expectedPath = path.join(workDir, 't212-report-42.csv')

    expect(stderr.value).toBe('')
    expect(JSON.parse(stdout.value)).toEqual({
      bytes: csvBytes.byteLength,
      path: expectedPath,
      reportId: 42,
    })
    expect(new Uint8Array(await readFile(expectedPath))).toEqual(csvBytes)
    expect(await readdir(workDir)).toEqual(['t212-report-42.csv'])

    expect(calls).toHaveLength(2)
    const [listCall, downloadCall] = calls as [FetchCall, FetchCall]
    expect(getFetchUrl(listCall)).toBe('https://live.trading212.com/api/v0/equity/history/exports')
    expect(getRequestHeader(listCall, 'authorization')).toMatch(/^Basic /)
    expect(getFetchUrl(downloadCall)).toBe(downloadLink)
  })

  it('never sends credentials to the download link', async () => {
    const { runtime, calls } = setup()

    await expect(
      runCli(['node', 't212', 'history', 'exports', 'download', '42'], runtime),
    ).resolves.toBe(0)

    const downloadCall = calls[1] as FetchCall

    expect(downloadCall.input instanceof Request).toBe(false)
    expect(getRequestHeader(downloadCall, 'authorization')).toBeNull()
    expect(downloadCall.init?.headers).toBeUndefined()
    expect(downloadCall.init?.credentials).toBeUndefined()
  })

  it('writes to the --file path relative to the working directory', async () => {
    const { runtime, stdout } = setup()

    await expect(
      runCli(
        ['node', 't212', 'history', 'exports', 'download', '42', '--file', 'report.csv'],
        runtime,
      ),
    ).resolves.toBe(0)

    const expectedPath = path.join(workDir, 'report.csv')

    expect(JSON.parse(stdout.value)).toEqual({
      bytes: csvBytes.byteLength,
      path: expectedPath,
      reportId: 42,
    })
    expect(new Uint8Array(await readFile(expectedPath))).toEqual(csvBytes)
  })

  it('streams raw bytes to stdout with --file - and prints nothing else', async () => {
    const { runtime, stdout, stderr } = setup()

    await expect(
      runCli(['node', 't212', 'history', 'exports', 'download', '42', '--file', '-'], runtime),
    ).resolves.toBe(0)

    expect(new Uint8Array(stdout.bytes)).toEqual(csvBytes)
    expect(stderr.value).toBe('')
    expect(await readdir(workDir)).toEqual([])
  })

  it('waits for each stdout write to complete before writing the next chunk', async () => {
    const encoder = new TextEncoder()
    const parts = ['first,', 'second,', 'third\n'].map((part) => encoder.encode(part))
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const part of parts) {
          controller.enqueue(part)
        }
        controller.close()
      },
    })
    const { runtime } = setup({ download: { body } })
    const written: Uint8Array[] = []
    let pending = false
    let overlapped = false
    runtime.stdout = {
      write: (chunk, callback) => {
        overlapped ||= pending
        pending = true
        written.push(typeof chunk === 'string' ? encoder.encode(chunk) : chunk)
        setTimeout(() => {
          pending = false
          callback?.()
        }, 5)
        return false
      },
    }

    await expect(
      runCli(['node', 't212', 'history', 'exports', 'download', '42', '--file', '-'], runtime),
    ).resolves.toBe(0)

    expect(overlapped).toBe(false)
    expect(written).toHaveLength(3)
    expect(Buffer.concat(written).toString('utf8')).toBe('first,second,third\n')
  })

  it('exits 0 quietly when stdout is closed early with --file -', async () => {
    const { runtime, stderr } = setup()
    runtime.stdout = {
      write: (_chunk, callback) => {
        callback?.(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }))
        return false
      },
    }

    await expect(
      runCli(['node', 't212', 'history', 'exports', 'download', '42', '--file', '-'], runtime),
    ).resolves.toBe(0)

    expect(stderr.value).toBe('')
  })

  it('fails with output_write_failed when stdout errors with --file -', async () => {
    const { runtime, stderr } = setup()
    runtime.stdout = {
      write: (_chunk, callback) => {
        callback?.(Object.assign(new Error('write EIO'), { code: 'EIO' }))
        return false
      },
    }

    await expect(
      runCli(['node', 't212', 'history', 'exports', 'download', '42', '--file', '-'], runtime),
    ).resolves.not.toBe(0)

    expect(JSON.parse(stderr.value)).toMatchObject({ error: { code: 'output_write_failed' } })
  })

  it('retries a rate-limited report lookup, then downloads without credentials', async () => {
    const { runtime, stdout, calls, sleeps } = setup({ exportsRateLimited: 1 })

    await expect(
      runCli(['node', 't212', 'history', 'exports', 'download', '42'], runtime),
    ).resolves.toBe(0)

    expect(calls.map((call) => getFetchUrl(call))).toEqual([
      'https://live.trading212.com/api/v0/equity/history/exports',
      'https://live.trading212.com/api/v0/equity/history/exports',
      downloadLink,
    ])
    expect(sleeps.length).toBeGreaterThan(0)
    expect(getRequestHeader(calls[2] as FetchCall, 'authorization')).toBeNull()
    expect(JSON.parse(stdout.value)).toMatchObject({ bytes: csvBytes.byteLength, reportId: 42 })
  })

  it('does not retry a rate-limited download link', async () => {
    const { runtime, stderr, calls, sleeps } = setup({
      download: { body: 'SlowDown', status: 429, statusText: 'Too Many Requests' },
    })

    await expect(
      runCli(['node', 't212', 'history', 'exports', 'download', '42'], runtime),
    ).resolves.toBe(1)

    expect(calls.filter((call) => getFetchUrl(call) === downloadLink)).toHaveLength(1)
    expect(sleeps).toEqual([])
    expect(JSON.parse(stderr.value)).toMatchObject({
      error: { code: 'download_failed', details: { status: 429 } },
    })
    expect(stderr.value).not.toContain('supersecretsignature')
  })

  it('works in read-only mode', async () => {
    const { runtime, stdout } = setup({ env: { ...credentials, T212_READ_ONLY: 'true' } })

    await expect(
      runCli(['node', 't212', '--read-only', 'history', 'exports', 'download', '42'], runtime),
    ).resolves.toBe(0)

    expect(JSON.parse(stdout.value)).toMatchObject({ reportId: 42 })
  })

  it('fails with exit code 5 when the report does not exist', async () => {
    const { runtime, stderr, calls } = setup()

    await expect(
      runCli(['node', 't212', 'history', 'exports', 'download', '99'], runtime),
    ).resolves.toBe(5)

    expect(stderr.value).toContain('Report 99 was not found')
    expect(calls).toHaveLength(1)
    expect(await readdir(workDir)).toEqual([])
  })

  it('fails with exit code 1 when the report is not finished', async () => {
    const { runtime, stderr, calls } = setup()

    await expect(
      runCli(['node', 't212', 'history', 'exports', 'download', '7'], runtime),
    ).resolves.toBe(1)

    expect(stderr.value).toContain('Report 7 is not ready')
    expect(stderr.value).toContain('Processing')
    expect(calls).toHaveLength(1)
  })

  it.each([
    'Queued',
    'Processing',
    'Running',
  ])('reports %s as not ready with exit code 1', async (status) => {
    const { runtime, stderr, calls } = setup({ reports: [{ reportId: 42, status }] })

    await expect(
      runCli(['node', 't212', 'history', 'exports', 'download', '42'], runtime),
    ).resolves.toBe(1)

    expect(stderr.value).toContain(`Report 42 is not ready for download (status: ${status})`)
    expect(calls).toHaveLength(1)
  })

  it.each([
    'Failed',
    'Canceled',
  ])('reports %s as permanently failed with exit code 1', async (status) => {
    const { runtime, stderr, calls } = setup({
      reports: [{ downloadLink, reportId: 42, status }],
    })

    await expect(
      runCli(['node', 't212', 'history', 'exports', 'download', '42'], runtime),
    ).resolves.toBe(1)

    expect(stderr.value).toContain(`has status ${status} and will never be downloadable`)
    expect(stderr.value).toContain('history exports request')
    expect(stderr.value).not.toContain('not ready')
    expect(calls).toHaveLength(1)
    expect(await readdir(workDir)).toEqual([])
  })

  it('creates downloaded files with mode 0600, also when replacing with --force', async () => {
    const { runtime } = setup()
    const target = path.join(workDir, 't212-report-42.csv')
    await writeFile(target, 'old', { mode: 0o644 })

    await expect(
      runCli(['node', 't212', 'history', 'exports', 'download', '42', '--force'], runtime),
    ).resolves.toBe(0)

    expect((await stat(target)).mode & 0o777).toBe(0o600)
  })

  it('fails with exit code 1 when a finished report has no download link', async () => {
    const { runtime, stderr, calls } = setup({ reports: [{ reportId: 42, status: 'Finished' }] })

    await expect(
      runCli(['node', 't212', 'history', 'exports', 'download', '42'], runtime),
    ).resolves.toBe(1)

    expect(stderr.value).toContain('finished but no download link is available yet')
    expect(calls).toHaveLength(1)
  })

  it('rejects non-https download links without fetching them', async () => {
    const { runtime, stderr, calls } = setup({
      reports: [
        {
          downloadLink: 'http://reports.example-bucket.test/42.csv?sig=leak',
          reportId: 42,
          status: 'Finished',
        },
      ],
    })

    await expect(
      runCli(['node', 't212', 'history', 'exports', 'download', '42'], runtime),
    ).resolves.toBe(1)

    expect(stderr.value).toContain('https')
    expect(stderr.value).not.toContain('sig=leak')
    expect(calls).toHaveLength(1)
    expect(await readdir(workDir)).toEqual([])
  })

  it('follows https redirects manually without sending credentials', async () => {
    const redirected = 'https://reports.example-bucket.test/final/42.csv?sig=second'
    const { runtime, stdout, calls } = setup({ redirects: { [downloadLink]: redirected } })

    await expect(
      runCli(['node', 't212', 'history', 'exports', 'download', '42'], runtime),
    ).resolves.toBe(0)

    expect(calls.map((call) => getFetchUrl(call))).toEqual([
      'https://live.trading212.com/api/v0/equity/history/exports',
      downloadLink,
      redirected,
    ])

    for (const call of calls.slice(1)) {
      expect(call.init?.redirect).toBe('manual')
      expect(getRequestHeader(call, 'authorization')).toBeNull()
    }

    expect(JSON.parse(stdout.value)).toMatchObject({ bytes: csvBytes.byteLength, reportId: 42 })
    expect(stdout.value).not.toContain('sig=second')
  })

  it('rejects a redirect to a non-https URL without requesting it', async () => {
    const insecure = 'http://reports.example-bucket.test/42.csv?sig=leak'
    const { runtime, stderr, calls } = setup({ redirects: { [downloadLink]: insecure } })

    await expect(
      runCli(['node', 't212', 'history', 'exports', 'download', '42'], runtime),
    ).resolves.toBe(1)

    expect(stderr.value).toContain('non-https')
    expect(stderr.value).not.toContain('sig=leak')
    expect(calls.map((call) => getFetchUrl(call))).not.toContain(insecure)
    expect(calls).toHaveLength(2)
    expect(await readdir(workDir)).toEqual([])
  })

  it('stops after too many redirects', async () => {
    const hop = (n: number) => `https://reports.example-bucket.test/hop/${n}?sig=hop`
    const redirects: Record<string, string> = { [downloadLink]: hop(1) }
    for (let n = 1; n <= 10; n++) {
      redirects[hop(n)] = hop(n + 1)
    }
    const { runtime, stderr, calls } = setup({ redirects })

    await expect(
      runCli(['node', 't212', 'history', 'exports', 'download', '42'], runtime),
    ).resolves.toBe(1)

    expect(stderr.value).toContain('too many redirects')
    expect(stderr.value).not.toContain('sig=hop')
    expect(calls).toHaveLength(7)
  })

  it('fails with exit code 1 on a non-OK download without printing the URL', async () => {
    const { runtime, stdout, stderr } = setup({
      download: { body: 'AccessDenied', status: 403, statusText: 'Forbidden' },
    })

    await expect(
      runCli(['node', 't212', 'history', 'exports', 'download', '42'], runtime),
    ).resolves.toBe(1)

    expect(stderr.value).toContain('HTTP 403 Forbidden')
    expect(stderr.value).toContain('reports.example-bucket.test')
    expect(stderr.value).not.toContain('supersecretsignature')
    expect(stderr.value).not.toContain('/exports/42.csv')
    expect(stdout.value).not.toContain('supersecretsignature')
    expect(await readdir(workDir)).toEqual([])
  })

  it('refuses to overwrite an existing file before any network request', async () => {
    const { runtime, stderr, calls } = setup()
    const existing = path.join(workDir, 't212-report-42.csv')
    await writeFile(existing, 'keep me')

    await expect(
      runCli(['node', 't212', 'history', 'exports', 'download', '42'], runtime),
    ).resolves.toBe(2)

    expect(stderr.value).toContain('already exists')
    expect(stderr.value).toContain('--force')
    expect(calls).toHaveLength(0)
    expect(await readFile(existing, 'utf8')).toBe('keep me')
  })

  it('does not clobber a file that appears during the download', async () => {
    const { runtime, stderr } = setup()
    const target = path.join(workDir, 't212-report-42.csv')
    const originalFetch = runtime.fetch
    runtime.fetch = async (input, init) => {
      const response = await originalFetch(input, init)

      if (getFetchUrl({ init, input }) === downloadLink) {
        await writeFile(target, 'appeared meanwhile')
      }

      return response
    }

    await expect(
      runCli(['node', 't212', 'history', 'exports', 'download', '42'], runtime),
    ).resolves.toBe(2)

    expect(stderr.value).toContain('already exists')
    expect(await readFile(target, 'utf8')).toBe('appeared meanwhile')
    expect(await readdir(workDir)).toEqual(['t212-report-42.csv'])
  })

  it('overwrites an existing file with --force', async () => {
    const { runtime, stdout } = setup()
    const existing = path.join(workDir, 't212-report-42.csv')
    await writeFile(existing, 'old content')

    await expect(
      runCli(['node', 't212', 'history', 'exports', 'download', '42', '--force'], runtime),
    ).resolves.toBe(0)

    expect(JSON.parse(stdout.value)).toMatchObject({ bytes: csvBytes.byteLength, reportId: 42 })
    expect(new Uint8Array(await readFile(existing))).toEqual(csvBytes)
    expect(await readdir(workDir)).toEqual(['t212-report-42.csv'])
  })

  it('fails before any network request when the destination directory is missing', async () => {
    const { runtime, stderr, calls } = setup()

    await expect(
      runCli(
        ['node', 't212', 'history', 'exports', 'download', '42', '--file', 'missing/report.csv'],
        runtime,
      ),
    ).resolves.toBe(2)

    expect(stderr.value).toContain('does not exist')
    expect(stderr.value).not.toContain('.download.tmp')
    expect(calls).toHaveLength(0)
  })

  it('fails before any network request when the destination is a directory', async () => {
    const { runtime, stderr, calls } = setup()
    await mkdir(path.join(workDir, 'existing-dir'))

    await expect(
      runCli(
        [
          'node',
          't212',
          'history',
          'exports',
          'download',
          '42',
          '--file',
          'existing-dir',
          '--force',
        ],
        runtime,
      ),
    ).resolves.toBe(2)

    expect(stderr.value).toContain('is a directory')
    expect(calls).toHaveLength(0)
  })

  it('reports a body that fails mid-stream as download_failed and cleans up', async () => {
    const encoder = new TextEncoder()
    let pulls = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++

        if (pulls <= 2) {
          controller.enqueue(encoder.encode(`chunk-${pulls}\n`))
          return
        }

        controller.error(
          Object.assign(new Error(`socket hang up ${downloadLink}`), {
            code: 'ECONNRESET',
          }),
        )
      },
    })
    const { runtime, stdout, stderr } = setup({ download: { body } })

    await expect(
      runCli(['node', 't212', 'history', 'exports', 'download', '42'], runtime),
    ).resolves.toBe(1)

    expect(stderr.value).toContain('interrupted')
    expect(stderr.value).toContain('ECONNRESET')
    expect(stderr.value).toContain('reports.example-bucket.test')
    expect(stderr.value).not.toContain('supersecretsignature')
    expect(stdout.value).toBe('')
    expect(await readdir(workDir)).toEqual([])
  })

  it('surfaces only the network error code when the download request fails', async () => {
    const { runtime, stderr } = setup()
    const originalFetch = runtime.fetch
    runtime.fetch = async (input, init) => {
      if (getFetchUrl({ init, input }) === downloadLink) {
        throw new TypeError('fetch failed', {
          cause: Object.assign(new Error(`getaddrinfo ENOTFOUND ${downloadLink}`), {
            code: 'ENOTFOUND',
          }),
        })
      }

      return originalFetch(input, init)
    }

    await expect(
      runCli(['node', 't212', 'history', 'exports', 'download', '42'], runtime),
    ).resolves.toBe(1)

    expect(stderr.value).toContain('(ENOTFOUND)')
    expect(stderr.value).not.toContain('supersecretsignature')
    expect(await readdir(workDir)).toEqual([])
  })

  it('rejects a non-positive report ID', async () => {
    const { runtime, calls } = setup()

    await expect(
      runCli(['node', 't212', 'history', 'exports', 'download', '0'], runtime),
    ).resolves.not.toBe(0)

    expect(calls).toHaveLength(0)
  })
})
