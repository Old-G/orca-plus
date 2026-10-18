// Custom build (hq-spaces): the workspaces under the global HQ — `workspaces/<slug>/workspace.yaml`
// each — with the projects each one holds, resolved against HQ's project pages.
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse } from 'yaml'
import {
  HQ_SPACE_FILE,
  HQ_SPACES_DIR,
  readHqSpaceFile,
  resolveHqSpaces,
  type HqSpace,
  type HqSpaceFile
} from '../../shared/hq-spaces'
import { listHqProjectPages } from '../hq-project-pages/hq-project-pages'

async function readSpaceFiles(hqPath: string): Promise<{ slug: string; file: HqSpaceFile }[]> {
  const root = join(hqPath, HQ_SPACES_DIR)
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  const files = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        try {
          const text = await readFile(join(root, entry.name, HQ_SPACE_FILE), 'utf8')
          const file = readHqSpaceFile(entry.name, parse(text))
          return file ? { slug: entry.name, file } : null
        } catch {
          // Why: a folder without a readable workspace.yaml is not a workspace yet.
          return null
        }
      })
  )
  return files.filter((entry): entry is { slug: string; file: HqSpaceFile } => entry !== null)
}

export async function listHqSpaces(hqPath: string): Promise<HqSpace[]> {
  const files = await readSpaceFiles(hqPath)
  if (files.length === 0) {
    return []
  }
  const pages = await listHqProjectPages(hqPath).catch(() => [])
  return resolveHqSpaces(
    files,
    pages.map((page) => ({ repoId: page.repoId, slug: page.slug, group: page.group }))
  )
}
