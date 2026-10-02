// Custom build (hq): keeps HQ's all-projects diagram current — wiki/diagrams/projects.architecture.json
// plus its Archify render, the same layout Strata gives a repo's own diagrams. Re-rendered only
// when the JSON changes, and committed alone so HQ's sync still finds a clean tree.
import { join } from 'node:path'
import type { HqProjectMapResult } from '../../shared/hq-project-pages'
import { listHqProjectPages } from '../hq-project-pages/hq-project-pages'
import { buildHqProjectMap } from './hq-project-map-layout'

export const HQ_MAP_JSON = 'wiki/diagrams/projects.architecture.json'
export const HQ_MAP_HTML = 'wiki/diagrams/projects.html'

export type HqMapCommandResult = { code: number | null; stdout: string; stderr: string }

export type HqProjectMapDeps = {
  hqPath: () => string | null
  groupOrder: () => readonly string[]
  /** Archify's CLI script, or null when the archify skill is not installed. */
  archifyPath: () => string | null
  /** Runs `node <args>` (Electron as Node) or `git <args>` in `cwd`. */
  run: (
    program: 'node' | 'git',
    args: readonly string[],
    cwd: string
  ) => Promise<HqMapCommandResult>
  readText: (path: string) => Promise<string | null>
  writeText: (path: string, text: string) => Promise<void>
  /** A fresh scratch dir for the render; removed by the caller of `cleanup`. */
  makeScratchDir: () => Promise<{ dir: string; cleanup: () => Promise<void> }>
  log: (message: string) => void
}

async function commitMap(deps: HqProjectMapDeps, hq: string, message: string): Promise<void> {
  const inside = await deps.run('git', ['rev-parse', '--is-inside-work-tree'], hq)
  if (inside.code !== 0) {
    return
  }
  const add = await deps.run('git', ['add', '--', HQ_MAP_JSON, HQ_MAP_HTML], hq)
  // Why: a pathspec commit takes only the map, never the owner's other staged or unstaged edits.
  const commit =
    add.code === 0
      ? await deps.run('git', ['commit', '-m', message, '--', HQ_MAP_JSON, HQ_MAP_HTML], hq)
      : add
  if (commit.code !== 0) {
    deps.log(`map not committed: ${(commit.stderr || commit.stdout).trim()}`)
  }
}

export async function ensureHqProjectMap(deps: HqProjectMapDeps): Promise<HqProjectMapResult> {
  const hq = deps.hqPath()
  if (!hq) {
    return { ok: false, reason: 'off' }
  }
  const doc = buildHqProjectMap({
    pages: await listHqProjectPages(hq),
    groupOrder: deps.groupOrder()
  })
  const json = `${JSON.stringify(doc, null, 2)}\n`
  const projects = doc.components.length
  const relations = doc.connections.length
  const jsonPath = join(hq, HQ_MAP_JSON)
  const htmlPath = join(hq, HQ_MAP_HTML)
  const [currentJson, currentHtml] = await Promise.all([
    deps.readText(jsonPath),
    deps.readText(htmlPath)
  ])
  if (currentJson === json && currentHtml) {
    return { ok: true, html: currentHtml, projects, relations }
  }
  const archify = deps.archifyPath()
  if (!archify) {
    return { ok: false, reason: 'archify-missing' }
  }
  // Why: render in scratch first, so a failed render never leaves a JSON without its picture.
  const scratch = await deps.makeScratchDir()
  try {
    const scratchJson = join(scratch.dir, 'projects.architecture.json')
    const scratchHtml = join(scratch.dir, 'projects.html')
    await deps.writeText(scratchJson, json)
    const render = await deps.run(
      'node',
      [archify, 'render', 'architecture', scratchJson, scratchHtml],
      scratch.dir
    )
    const html = render.code === 0 ? await deps.readText(scratchHtml) : null
    if (!html) {
      return { ok: false, reason: 'failed', error: (render.stderr || render.stdout).trim() }
    }
    await deps.writeText(jsonPath, json)
    await deps.writeText(htmlPath, html)
    await commitMap(
      deps,
      hq,
      `chore(map): all-projects diagram — ${projects} projects, ${relations} relations`
    )
    return { ok: true, html, projects, relations }
  } finally {
    await scratch.cleanup()
  }
}
