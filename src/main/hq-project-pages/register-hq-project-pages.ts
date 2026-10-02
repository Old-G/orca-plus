// Custom build (hq): IPC for HQ's Projects, Wiki and Map tabs — the configured HQ folder's project
// pages, its markdown pages, the all-projects diagram, one project's own diagram, the reviews
// waiting on the user, and the git state of workspaces whose agents went quiet.
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import { ipcMain } from 'electron'
import type { Store } from '../persistence'
import type {
  HqProjectDiagramResult,
  HqProjectMapResult,
  HqProjectPagesResult,
  HqReviewsResult,
  HqWorktreeGitStates,
  HqWikiPageResult,
  HqWikiTreeResult
} from '../../shared/hq-project-pages'
import { runProcess } from '../../shared/child-process/run-process'
import { ghExecFileAsync, gitExecFileAsync, glabExecFileAsync } from '../git/runner'
import { getGlabKnownHosts } from '../gitlab/gitlab-known-host-probe'
import { listHqReviews } from '../hq-today/hq-reviews'
import { createHqWorktreeGitStateReader } from '../hq-today/hq-worktree-git-state'
import { ensureHqProjectMap } from '../hq-project-map/hq-project-map'
import { readHqProjectDiagram } from './hq-project-diagram'
import { listHqProjectPages } from './hq-project-pages'
import { listHqWikiEntries, readHqWikiPage } from './hq-wiki-files'

const MAP_TIMEOUT_MS = 120_000
// Why: Today re-mounts often; reviews move slowly and gh/glab calls cost rate limit.
const REVIEWS_TTL_MS = 120_000

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Where `npx skills add tt-a1i/archify -g` puts the CLI; ARCHIFY_BIN overrides, as in Strata. */
function findArchify(): string | null {
  const candidates = [
    process.env.ARCHIFY_BIN,
    join(homedir(), '.claude', 'skills', 'archify', 'bin', 'archify.mjs'),
    join(homedir(), '.agents', 'skills', 'archify', 'bin', 'archify.mjs')
  ]
  return candidates.find((candidate) => candidate && existsSync(candidate)) ?? null
}

export function registerHqProjectPagesHandlers(store: Store): void {
  const hqPath = (): string | null => store.getSettings().hqPath ?? null
  let mapInFlight: Promise<HqProjectMapResult> | null = null
  let reviews: { at: number; result: Promise<HqReviewsResult> } | null = null
  const readGitStates = createHqWorktreeGitStateReader({
    status: async (path) =>
      (await gitExecFileAsync(['status', '--porcelain', '-b'], { cwd: path })).stdout,
    now: Date.now
  })

  ipcMain.handle('hqProjects:list', async (): Promise<HqProjectPagesResult> => {
    const hq = hqPath()
    if (!hq) {
      return { ok: true, pages: [] }
    }
    try {
      return { ok: true, pages: await listHqProjectPages(hq) }
    } catch (error) {
      return { ok: false, error: errorText(error) }
    }
  })

  ipcMain.handle('hqProjects:wikiTree', async (): Promise<HqWikiTreeResult> => {
    const hq = hqPath()
    if (!hq) {
      return { ok: true, entries: [] }
    }
    try {
      return { ok: true, entries: await listHqWikiEntries(hq) }
    } catch (error) {
      return { ok: false, error: errorText(error) }
    }
  })

  ipcMain.handle(
    'hqProjects:wikiPage',
    async (_event, path: unknown): Promise<HqWikiPageResult> => {
      const hq = hqPath()
      if (!hq || typeof path !== 'string') {
        return { ok: false, error: 'No HQ folder is set.' }
      }
      try {
        return { ok: true, markdown: await readHqWikiPage(hq, path) }
      } catch (error) {
        return { ok: false, error: errorText(error) }
      }
    }
  )

  ipcMain.handle(
    'hqProjects:projectDiagram',
    (_event, repoId: unknown): Promise<HqProjectDiagramResult> =>
      readHqProjectDiagram(typeof repoId === 'string' ? store.getRepo(repoId) : undefined)
  )

  ipcMain.handle('hqProjects:reviews', (_event, refresh: unknown): Promise<HqReviewsResult> => {
    if (!reviews || refresh === true || Date.now() - reviews.at > REVIEWS_TTL_MS) {
      const result = listHqReviews({
        gh: async (args) => (await ghExecFileAsync(args)).stdout,
        glab: async (args) => (await glabExecFileAsync(args)).stdout,
        gitlabHosts: () => getGlabKnownHosts()
      })
      reviews = { at: Date.now(), result }
      // Why: a failed read must not be served from cache for two minutes.
      void result.catch(() => {
        reviews = null
      })
    }
    return reviews.result
  })

  ipcMain.handle('hqProjects:gitState', (_event, paths: unknown): Promise<HqWorktreeGitStates> =>
    // Why: read-only status of local checkouts; remote workspaces are never passed here.
    readGitStates(
      Array.isArray(paths)
        ? paths.filter((path): path is string => typeof path === 'string' && isAbsolute(path))
        : []
    )
  )

  ipcMain.handle('hqProjects:map', (): Promise<HqProjectMapResult> => {
    // Why: tabs re-mount; one render serves every request that arrives while it runs.
    mapInFlight ??= ensureHqProjectMap({
      hqPath,
      groupOrder: () =>
        [...store.getProjectGroups()]
          .sort((a, b) => a.tabOrder - b.tabOrder || a.name.localeCompare(b.name))
          .map((group) => group.name),
      archifyPath: findArchify,
      run: async (program, args, cwd) => {
        const result = await runProcess(
          program === 'node'
            ? {
                // Why: Electron runs as plain Node here, so archify needs no Node install of its own.
                program: process.execPath,
                args,
                cwd,
                env: {
                  ...process.env,
                  ELECTRON_RUN_AS_NODE: '1',
                  ARCHIFY_UPDATE_CHECK_DISABLED: '1'
                },
                timeoutMs: MAP_TIMEOUT_MS
              }
            : { program: 'git', args, cwd, timeoutMs: MAP_TIMEOUT_MS }
        )
        return { code: result.code, stdout: result.stdout, stderr: result.stderr }
      },
      readText: async (path) => readFile(path, 'utf8').catch(() => null),
      writeText: async (path, text) => {
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, text)
      },
      makeScratchDir: async () => {
        const dir = await mkdtemp(join(tmpdir(), 'orca-hq-map-'))
        return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) }
      },
      log: (message) => console.log('[hq-map]', message)
    })
      .catch((error: unknown) => ({
        ok: false as const,
        reason: 'failed' as const,
        error: errorText(error)
      }))
      .finally(() => {
        mapInFlight = null
      })
    return mapInFlight
  })
}
