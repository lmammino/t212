import { describe, expect, it } from 'vitest'
import { runCli } from '../src/cli/run.ts'
import { detectOutputFormat } from '../src/config/runtime-config.ts'
import { isJsonOutput, writeResult } from '../src/output/format.ts'
import { createJsonFetch, createTestRuntime } from './helpers.ts'

const credentials = {
  T212_API_KEY: 'key',
  T212_API_SECRET: 'secret',
}

function render(format: 'json' | 'json-compact' | 'ndjson', data: unknown): string {
  const { runtime, stdout } = createTestRuntime()
  writeResult(runtime, format, data)
  return stdout.value
}

describe('output formats', () => {
  const object = { a: 1, nested: { b: [1, 2] } }
  const array = [{ id: 1 }, { id: 2, tags: ['x'] }]

  it('json prints indented JSON', () => {
    expect(render('json', object)).toBe(`${JSON.stringify(object, null, 2)}\n`)
    expect(render('json', array)).toBe(`${JSON.stringify(array, null, 2)}\n`)
    expect(render('json', [])).toBe('[]\n')
    expect(render('json', null)).toBe('null\n')
    expect(render('json', undefined)).toBe('null\n')
  })

  it('json-compact prints the whole value on one line', () => {
    expect(render('json-compact', object)).toBe('{"a":1,"nested":{"b":[1,2]}}\n')
    expect(render('json-compact', array)).toBe('[{"id":1},{"id":2,"tags":["x"]}]\n')
    expect(render('json-compact', [])).toBe('[]\n')
    expect(render('json-compact', null)).toBe('null\n')
    expect(render('json-compact', undefined)).toBe('null\n')
  })

  it('ndjson prints one line per array element and other values on one line', () => {
    expect(render('ndjson', object)).toBe('{"a":1,"nested":{"b":[1,2]}}\n')
    expect(render('ndjson', array)).toBe('{"id":1}\n{"id":2,"tags":["x"]}\n')
    expect(render('ndjson', [])).toBe('')
    expect(render('ndjson', null)).toBe('null\n')
    expect(render('ndjson', undefined)).toBe('null\n')
  })

  it('treats every format except pretty as JSON output', () => {
    expect(isJsonOutput('json')).toBe(true)
    expect(isJsonOutput('json-compact')).toBe(true)
    expect(isJsonOutput('ndjson')).toBe(true)
    expect(isJsonOutput('pretty')).toBe(false)
  })

  it('lists every output format in global help', async () => {
    const { runtime, stdout } = createTestRuntime()

    await expect(runCli(['node', 't212', '--help'], runtime)).resolves.toBe(0)

    for (const format of ['json', 'json-compact', 'ndjson', 'pretty']) {
      expect(stdout.value).toContain(format)
    }
  })

  it('rejects unknown output formats with exit code 2', async () => {
    const fetchSetup = createJsonFetch([])
    const { runtime, stderr } = createTestRuntime({ env: credentials, fetch: fetchSetup.fetch })

    await expect(
      runCli(['node', 't212', '--output', 'yaml', 'positions', 'list'], runtime),
    ).resolves.toBe(2)

    expect(fetchSetup.calls).toHaveLength(0)
    expect(stderr.value).toContain('json, json-compact, ndjson, pretty')
  })

  it('detects every output format from argv before parsing', () => {
    expect(detectOutputFormat(['node', 't212', '--output', 'ndjson', 'x'])).toBe('ndjson')
    expect(detectOutputFormat(['node', 't212', '--output=json-compact', 'x'])).toBe('json-compact')
    expect(detectOutputFormat(['node', 't212', '--output', 'pretty', 'x'])).toBe('pretty')
    expect(detectOutputFormat(['node', 't212', '--output', 'yaml', 'x'])).toBe('json')
  })

  it.each([
    'ndjson',
    'json-compact',
  ])('prints usage errors as the one-line JSON envelope with --output %s', async (format) => {
    const { runtime, stderr } = createTestRuntime()

    await expect(
      runCli(['node', 't212', '--output', format, 'bogus-command'], runtime),
    ).resolves.toBe(2)

    expect(stderr.value.trimEnd().split('\n')).toHaveLength(1)
    expect(JSON.parse(stderr.value)).toMatchObject({ error: { code: 'usage_error' } })
  })

  it('applies --output ndjson to array endpoints', async () => {
    const fetchSetup = createJsonFetch([{ ticker: 'A' }, { ticker: 'B' }])
    const { runtime, stdout } = createTestRuntime({ env: credentials, fetch: fetchSetup.fetch })

    await expect(
      runCli(['node', 't212', '--output', 'ndjson', 'positions', 'list'], runtime),
    ).resolves.toBe(0)

    expect(stdout.value).toBe('{"ticker":"A"}\n{"ticker":"B"}\n')
  })
})
