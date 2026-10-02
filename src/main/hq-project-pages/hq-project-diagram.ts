// Custom build (hq): a project's own Strata diagram for its HQ card — the Archify page Strata keeps in
// the project's wiki/diagrams/, read from the local checkout only.
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { HqProjectDiagramResult } from '../../shared/hq-project-pages'
import type { Repo } from '../../shared/repo-types'

const DIAGRAMS_DIR = join('wiki', 'diagrams')
const PREFERRED = 'system.html'
const MAX_DIAGRAM_BYTES = 8 * 1024 * 1024

/** Strata's system diagram first, else the first page by name; visual-check renders are not diagrams. */
export function pickHqProjectDiagram(names: readonly string[]): string | null {
  const pages = names
    .filter((name) => name.endsWith('.html') && !name.endsWith('.visual-check.html'))
    .sort((a, b) => a.localeCompare(b))
  return pages.includes(PREFERRED) ? PREFERRED : (pages[0] ?? null)
}

function isRemote(repo: Pick<Repo, 'connectionId' | 'executionHostId'>): boolean {
  return (
    Boolean(repo.connectionId) || Boolean(repo.executionHostId && repo.executionHostId !== 'local')
  )
}

export async function readHqProjectDiagram(
  repo: Pick<Repo, 'path' | 'connectionId' | 'executionHostId'> | undefined
): Promise<HqProjectDiagramResult> {
  if (!repo) {
    return { ok: false, reason: 'failed', error: 'Unknown project.' }
  }
  // Why: the checkout lives on another host; main cannot read its files from here.
  if (isRemote(repo)) {
    return { ok: false, reason: 'remote' }
  }
  const dir = join(repo.path, DIAGRAMS_DIR)
  const files = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const name = pickHqProjectDiagram(files.filter((file) => file.isFile()).map((file) => file.name))
  if (!name) {
    return { ok: false, reason: 'none' }
  }
  const path = join(dir, name)
  try {
    if ((await stat(path)).size > MAX_DIAGRAM_BYTES) {
      return { ok: false, reason: 'failed', error: `${name} is too large to show.` }
    }
    return { ok: true, html: await readFile(path, 'utf8'), name }
  } catch (error) {
    return {
      ok: false,
      reason: 'failed',
      error: error instanceof Error ? error.message : String(error)
    }
  }
}
