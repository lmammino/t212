import { randomUUID } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import {
  copyFile,
  type FileHandle,
  link,
  lstat,
  open,
  rename,
  stat,
  unlink,
} from 'node:fs/promises'
import path from 'node:path'
import { Command } from '@commander-js/extra-typings'
import { parsePositiveInteger } from '../cli/parsers.ts'
import { CliError } from '../errors.ts'
import type { components } from '../generated/trading212.ts'
import { unwrapApiResponse } from '../http/client.ts'
import { writeAndWait, writeResult } from '../output/format.ts'
import type { Runtime, WritableLike } from '../runtime.ts'
import { createReadContext } from './context.ts'

type ExportDownloadOptions = {
  file?: string
  force?: boolean
}

type ReportResponse = components['schemas']['ReportResponse']

type Download = {
  host: string
  response: Response
}

export function createExportsDownloadCommand(runtime: Runtime) {
  const download = new Command('download')
    .description(
      'Download a finished CSV report by report ID. Read action; allowed in read-only mode. ' +
        'Looks up the report via "history exports list" and fetches its download link ' +
        'without sending Trading 212 credentials. Writes ./t212-report-<reportId>.csv by ' +
        'default and prints { reportId, path, bytes }. Use --file (not --output, which ' +
        'selects the output format) to choose the destination, --file - to stream the CSV ' +
        'to stdout, and --force to overwrite an existing file. Saved files have mode 0600. ' +
        'Failed or Canceled reports exit with report_failed; request a new export instead.',
    )
    .argument('<reportId>', 'Report ID returned by "history exports request"', parsePositiveInteger)
    .option(
      '--file <path>',
      'Destination file path, or "-" to write the raw CSV to stdout (default: ./t212-report-<reportId>.csv). ' +
        'Files are created with mode 0600 (owner read/write only) regardless of umask; --force replaces an existing file with a new 0600 file',
    )
    .option('--force', 'Overwrite the destination file if it already exists')

  download.action(async (reportId) => {
    const options = download.opts() as ExportDownloadOptions
    const toStdout = options.file === '-'
    const destination = toStdout
      ? undefined
      : path.resolve(runtime.cwd(), options.file ?? `t212-report-${reportId}.csv`)
    const force = options.force === true

    const context = await createReadContext(download, runtime)

    if (destination !== undefined) {
      await assertDestinationUsable(destination, force)
    }

    const result = await context.client.GET('/api/v0/equity/history/exports')
    const reports = unwrapApiResponse<ReportResponse[]>(result, [])
    const report = reports.find((candidate) => candidate.reportId === reportId)

    if (report === undefined) {
      throw new CliError(`Report ${reportId} was not found.`, {
        code: 'report_not_found',
        details: { reportId },
        exitCode: 5,
      })
    }

    const status = report.status ?? null

    if (status === 'Failed' || status === 'Canceled') {
      throw new CliError(
        `Report ${reportId} has status ${status} and will never be downloadable. Request a new export with "history exports request".`,
        {
          code: 'report_failed',
          details: { reportId, status },
          exitCode: 1,
        },
      )
    }

    if (status !== 'Finished') {
      throw new CliError(
        `Report ${reportId} is not ready for download (status: ${status ?? 'unknown'}).`,
        {
          code: 'report_not_ready',
          details: { reportId, status },
          exitCode: 1,
        },
      )
    }

    if (typeof report.downloadLink !== 'string' || report.downloadLink === '') {
      throw new CliError(
        `Report ${reportId} is finished but no download link is available yet. Try again shortly.`,
        {
          code: 'report_not_ready',
          details: { reportId, status },
          exitCode: 1,
        },
      )
    }

    const fetched = await fetchDownload(runtime, report.downloadLink)

    if (toStdout || destination === undefined) {
      await streamToWritable(fetched, runtime.stdout)
      return
    }

    const bytes = await saveToFile(fetched, destination, force)

    writeResult(runtime, context.config.output, { reportId, path: destination, bytes })
  })

  return download
}

function parseDownloadLink(downloadLink: string): URL {
  let url: URL

  try {
    url = new URL(downloadLink)
  } catch {
    throw new CliError('Report download link is not a valid URL.', {
      code: 'invalid_download_link',
      exitCode: 1,
    })
  }

  if (url.protocol !== 'https:') {
    throw new CliError('Report download link must use https.', {
      code: 'invalid_download_link',
      details: { host: url.host, protocol: url.protocol },
      exitCode: 1,
    })
  }

  return url
}

// The download link is a presigned URL: its query string acts as a bearer token, so it must
// never be printed. It is fetched with plain runtime.fetch, never the Trading 212 client, and
// without any credentials or Authorization header. Redirects are followed manually so every
// hop is validated as https before any request is made to it.
const maxRedirects = 5
const redirectStatuses = new Set([301, 302, 303, 307, 308])

async function fetchDownload(runtime: Runtime, downloadLink: string): Promise<Download> {
  let url = parseDownloadLink(downloadLink)

  for (let redirects = 0; ; redirects++) {
    const host = url.host
    let response: Response

    try {
      response = await runtime.fetch(url, { method: 'GET', redirect: 'manual' })
    } catch (error) {
      throw downloadError(`Report download from ${host} failed`, host, error)
    }

    const location = response.headers.get('location')

    if (redirectStatuses.has(response.status) && location !== null) {
      await cancelBody(response)

      if (redirects >= maxRedirects) {
        throw new CliError(`Report download from ${host} failed: too many redirects.`, {
          code: 'download_failed',
          details: { host, status: response.status, statusText: response.statusText },
          exitCode: 1,
        })
      }

      url = resolveRedirect(url, location)
      continue
    }

    if (!response.ok) {
      await cancelBody(response)
      throw new CliError(
        `Report download from ${host} failed with HTTP ${response.status} ${response.statusText}`.trim(),
        {
          code: 'download_failed',
          details: { host, status: response.status, statusText: response.statusText },
          exitCode: 1,
        },
      )
    }

    return { host, response }
  }
}

// Only a short error code (e.g. ENOTFOUND, ECONNRESET) is surfaced from network failures: raw
// error messages are never printed, so nothing about the presigned link can leak.
function downloadError(message: string, host: string, error: unknown): CliError {
  const cause = errorCode(error)

  return new CliError(cause === undefined ? `${message}.` : `${message} (${cause}).`, {
    code: 'download_failed',
    details: cause === undefined ? { host } : { cause, host },
    exitCode: 1,
  })
}

function errorCode(error: unknown): string | undefined {
  const candidates = [error, error instanceof Error ? error.cause : undefined]

  for (const candidate of candidates) {
    if (typeof candidate === 'object' && candidate !== null && 'code' in candidate) {
      const code = candidate.code

      if (typeof code === 'string' && /^[A-Z][A-Z0-9_]*$/.test(code)) {
        return code
      }
    }
  }

  return undefined
}

async function* readBody({ host, response }: Download): AsyncGenerator<Uint8Array> {
  if (response.body === null) {
    return
  }

  const reader = response.body.getReader()
  let done = false

  try {
    while (true) {
      let result: Awaited<ReturnType<typeof reader.read>>

      try {
        result = await reader.read()
      } catch (error) {
        done = true
        throw downloadError(`Report download from ${host} was interrupted`, host, error)
      }

      if (result.done) {
        done = true
        return
      }

      yield result.value
    }
  } finally {
    if (!done) {
      await reader.cancel().catch(() => undefined)
    }

    reader.releaseLock()
  }
}

function resolveRedirect(current: URL, location: string): URL {
  let next: URL

  try {
    next = new URL(location, current)
  } catch {
    throw new CliError('Report download was redirected to an invalid URL.', {
      code: 'invalid_download_link',
      details: { host: current.host },
      exitCode: 1,
    })
  }

  if (next.protocol !== 'https:') {
    throw new CliError('Report download was redirected to a non-https URL.', {
      code: 'invalid_download_link',
      details: { host: next.host, protocol: next.protocol },
      exitCode: 1,
    })
  }

  return next
}

async function cancelBody(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined)
}

// Validates the destination before any network request so obvious problems fail fast.
async function assertDestinationUsable(destination: string, force: boolean): Promise<void> {
  const directory = path.dirname(destination)

  try {
    const directoryStats = await stat(directory)

    if (!directoryStats.isDirectory()) {
      throw invalidDestinationError(destination, `${directory} is not a directory`)
    }
  } catch (error) {
    if (isErrnoException(error) && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
      throw invalidDestinationError(destination, `directory ${directory} does not exist`)
    }

    throw error
  }

  let existing: Awaited<ReturnType<typeof lstat>> | undefined

  try {
    existing = await lstat(destination)
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') {
      return
    }

    throw error
  }

  if (existing.isDirectory()) {
    throw invalidDestinationError(destination, `${destination} is a directory`)
  }

  if (!force) {
    throw fileExistsError(destination)
  }
}

function invalidDestinationError(destination: string, reason: string): CliError {
  return new CliError(`Cannot write report to ${destination}: ${reason}.`, {
    code: 'invalid_destination',
    details: { path: destination },
    exitCode: 2,
  })
}

function fileWriteError(destination: string, error: unknown): CliError {
  const cause = errorCode(error)
  const suffix = cause === undefined ? '' : ` (${cause})`

  return new CliError(`Failed to write report to ${destination}${suffix}.`, {
    code: 'file_write_failed',
    details: cause === undefined ? { path: destination } : { cause, path: destination },
    exitCode: 1,
  })
}

function fileExistsError(destination: string): CliError {
  return new CliError(`File ${destination} already exists. Use --force to overwrite it.`, {
    code: 'file_exists',
    details: { path: destination },
    exitCode: 2,
  })
}

async function streamToWritable(download: Download, writable: WritableLike): Promise<void> {
  for await (const chunk of readBody(download)) {
    await writeAndWait(writable, chunk)
  }
}

async function saveToFile(download: Download, destination: string, force: boolean) {
  const directory = path.dirname(destination)
  const tempPath = path.join(
    directory,
    `.${path.basename(destination)}.${randomUUID()}.download.tmp`,
  )
  let handle: FileHandle | undefined
  let bytes = 0
  let renamed = false

  try {
    handle = await open(tempPath, 'wx', 0o600)

    for await (const chunk of readBody(download)) {
      await writeFully(handle, chunk)
      bytes += chunk.byteLength
    }

    await handle.close()
    handle = undefined

    if (force) {
      await rename(tempPath, destination)
      renamed = true
    } else {
      await placeNoClobber(tempPath, destination)
    }

    return bytes
  } catch (error) {
    if (error instanceof CliError) {
      throw error
    }

    throw fileWriteError(destination, error)
  } finally {
    await handle?.close().catch(() => undefined)

    if (!renamed) {
      await unlink(tempPath).catch(() => undefined)
    }
  }
}

async function writeFully(handle: FileHandle, chunk: Uint8Array): Promise<void> {
  let offset = 0

  while (offset < chunk.byteLength) {
    const { bytesWritten } = await handle.write(chunk, offset, chunk.byteLength - offset)

    if (bytesWritten <= 0) {
      throw new Error('Failed to write report data to disk.')
    }

    offset += bytesWritten
  }
}

// Places a copy of source at destination, failing if destination already exists. The caller
// removes source afterwards.
async function placeNoClobber(source: string, destination: string): Promise<void> {
  try {
    await link(source, destination)
  } catch (error) {
    if (isErrnoException(error) && error.code === 'EEXIST') {
      throw fileExistsError(destination)
    }

    if (!isErrnoException(error) || !['ENOTSUP', 'EPERM', 'ENOSYS'].includes(error.code ?? '')) {
      throw error
    }

    // Some filesystems do not support hard links; fall back to an exclusive copy, which still
    // fails if the destination appeared after the initial check.
    try {
      await copyFile(source, destination, fsConstants.COPYFILE_EXCL)
    } catch (copyError) {
      if (isErrnoException(copyError) && copyError.code === 'EEXIST') {
        throw fileExistsError(destination)
      }

      throw copyError
    }
  }
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}
