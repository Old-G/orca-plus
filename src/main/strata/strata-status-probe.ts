// Custom build (strata-status): reads a project's Strata files on the host that owns the project.
import { stat } from 'node:fs/promises'
import type { PathExistenceResult } from '../../shared/path-existence-batch'
import type { Repo } from '../../shared/repo-types'
import { classifyStrataStatus, type StrataStatus } from '../../shared/strata-status'
import { isENOENT } from '../ipc/filesystem-path-containment'
import { getSshFilesystemProvider } from '../providers/ssh-filesystem-dispatch'
import { getStoredRepoSshConnectionId } from '../repo-execution-host'
import { joinWorktreeRelativePath } from '../runtime/runtime-relative-paths'

const STRATA_FILES = ['WIKI.md', 'wiki/index.md', 'CLAUDE.md']

export type StrataSshFilesystem = {
  pathsExist?(filePaths: string[]): Promise<PathExistenceResult[]>
  stat(filePath: string): Promise<unknown>
}

export type StrataStatusProbeDeps = {
  getSshFilesystem: (connectionId: string) => StrataSshFilesystem | undefined
  statLocal: (filePath: string) => Promise<unknown>
}

const defaultDeps: StrataStatusProbeDeps = {
  getSshFilesystem: getSshFilesystemProvider,
  statLocal: stat
}

async function exists(check: () => Promise<unknown>): Promise<boolean | null> {
  try {
    await check()
    return true
  } catch (error) {
    return isENOENT(error) ? false : null
  }
}

async function readSshExistence(
  fs: StrataSshFilesystem,
  paths: string[]
): Promise<(boolean | null)[]> {
  if (!fs.pathsExist) {
    return Promise.all(paths.map((path) => exists(() => fs.stat(path))))
  }
  try {
    const rows = await fs.pathsExist(paths)
    return rows.map((row) => ('exists' in row ? row.exists : null))
  } catch {
    return paths.map(() => null)
  }
}

export async function readStrataStatus(
  repo: Pick<Repo, 'path' | 'connectionId' | 'executionHostId'>,
  deps: StrataStatusProbeDeps = defaultDeps
): Promise<StrataStatus> {
  // Why: a runtime-host project lives on another Orca, which reads its own files.
  if (repo.executionHostId?.startsWith('runtime:')) {
    return 'unknown'
  }
  const paths = STRATA_FILES.map((file) => joinWorktreeRelativePath(repo.path, file))
  const connectionId = getStoredRepoSshConnectionId(repo)
  let found: (boolean | null)[]
  if (connectionId) {
    // Why: with no live SSH provider the files are unverifiable, not absent.
    const fs = deps.getSshFilesystem(connectionId)
    found = fs ? await readSshExistence(fs, paths) : paths.map(() => null)
  } else {
    found = await Promise.all(paths.map((path) => exists(() => deps.statLocal(path))))
  }
  const byFile = new Map(STRATA_FILES.map((file, index) => [file, found[index] ?? null]))
  return classifyStrataStatus(async (file) => byFile.get(file) ?? null)
}
