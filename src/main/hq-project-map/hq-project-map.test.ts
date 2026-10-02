import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  HQ_MAP_HTML,
  HQ_MAP_JSON,
  ensureHqProjectMap,
  type HqProjectMapDeps
} from './hq-project-map'

let hq: string

beforeEach(() => {
  hq = mkdtempSync(join(tmpdir(), 'hq-map-'))
  mkdirSync(join(hq, 'projects'))
  writeFileSync(
    join(hq, 'projects', 'shop.md'),
    '---\nproject: shop\nid: r1\nstatus: active\nrelations: [api]\n---\n# shop — the storefront\n'
  )
  writeFileSync(join(hq, 'projects', 'api.md'), '---\nproject: api\nid: r2\n---\n# api\n')
})

afterEach(() => {
  rmSync(hq, { recursive: true, force: true })
})

function fakeDeps(overrides: Partial<HqProjectMapDeps> = {}) {
  const files = new Map<string, string>()
  const run = vi.fn<HqProjectMapDeps['run']>(async (program, args) => {
    if (program === 'node') {
      files.set(args[4], '<html>map</html>')
    }
    return { code: 0, stdout: '', stderr: '' }
  })
  const deps: HqProjectMapDeps = {
    hqPath: () => hq,
    groupOrder: () => [],
    archifyPath: () => '/skills/archify/bin/archify.mjs',
    run,
    readText: async (path) => files.get(path) ?? null,
    writeText: async (path, text) => {
      files.set(path, text)
    },
    makeScratchDir: async () => ({ dir: '/scratch', cleanup: async () => {} }),
    log: () => {},
    ...overrides
  }
  return { deps, files, run }
}

describe('ensureHqProjectMap', () => {
  it('renders the map into wiki/diagrams and commits only those two files', async () => {
    const { deps, files, run } = fakeDeps()
    const result = await ensureHqProjectMap(deps)
    expect(result).toEqual({ ok: true, html: '<html>map</html>', projects: 2, relations: 1 })
    expect(files.get(join(hq, HQ_MAP_HTML))).toBe('<html>map</html>')
    expect(JSON.parse(files.get(join(hq, HQ_MAP_JSON)) ?? '{}').diagram_type).toBe('architecture')
    expect(run.mock.calls.map(([program, args]) => [program, args.slice(0, 2)])).toEqual([
      ['node', ['/skills/archify/bin/archify.mjs', 'render']],
      ['git', ['rev-parse', '--is-inside-work-tree']],
      ['git', ['add', '--']],
      ['git', ['commit', '-m']]
    ])
    expect(run.mock.calls[3][1].slice(-3)).toEqual(['--', HQ_MAP_JSON, HQ_MAP_HTML])
  })

  it('reuses the current render when the pages have not changed', async () => {
    const { deps, run } = fakeDeps()
    await ensureHqProjectMap(deps)
    run.mockClear()
    expect(await ensureHqProjectMap(deps)).toMatchObject({ ok: true, projects: 2 })
    expect(run).not.toHaveBeenCalled()
  })

  it('writes nothing into HQ when the render fails, and says why', async () => {
    const { deps, files } = fakeDeps({
      run: async () => ({ code: 1, stdout: '', stderr: 'layout invalid' })
    })
    expect(await ensureHqProjectMap(deps)).toEqual({
      ok: false,
      reason: 'failed',
      error: 'layout invalid'
    })
    expect(files.has(join(hq, HQ_MAP_JSON))).toBe(false)
  })

  it('reports a missing archify, and an unset HQ folder', async () => {
    expect(await ensureHqProjectMap(fakeDeps({ archifyPath: () => null }).deps)).toEqual({
      ok: false,
      reason: 'archify-missing'
    })
    expect(await ensureHqProjectMap(fakeDeps({ hqPath: () => null }).deps)).toEqual({
      ok: false,
      reason: 'off'
    })
  })
})
