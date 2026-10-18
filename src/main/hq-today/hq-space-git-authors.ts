// Custom build (hq-space-git): each workspace's commit author — `git: { name, email }` in its
// workspace.yaml — kept in the local git config of its projects, so a company's commit carries its work
// address while the rest keep the global author. Only local repos; worktrees share it.
import type { HqSpace, HqSpaceGitAuthor } from '../../shared/hq-spaces'

// Why: workspace.yaml and the project list change rarely; ten minutes catches a new project soon.
const REFRESH_MS = 10 * 60_000

export type HqSpaceGitRepo = { id: string; path: string; local: boolean }

export type HqSpaceGitDeps = {
  spaces: () => Promise<HqSpace[]>
  repos: () => HqSpaceGitRepo[]
  /** The repo's own `git config --local` value, or null when unset. */
  readLocal: (path: string, key: 'user.name' | 'user.email') => Promise<string | null>
  writeLocal: (path: string, key: 'user.name' | 'user.email', value: string) => Promise<void>
}

export type HqSpaceGitChange = { path: string; space: string; from: string | null; to: string }

/** One pass: sets the author where a workspace names one and the repo's own config differs. */
export async function applyHqSpaceGitAuthors(deps: HqSpaceGitDeps): Promise<HqSpaceGitChange[]> {
  const spaces = await deps.spaces()
  const byRepo = new Map<string, { space: string; author: HqSpaceGitAuthor }>()
  for (const space of spaces) {
    if (space.git) {
      for (const repoId of space.repoIds) {
        byRepo.set(repoId, { space: space.slug, author: space.git })
      }
    }
  }
  const changes: HqSpaceGitChange[] = []
  for (const repo of deps.repos()) {
    const wanted = byRepo.get(repo.id)
    if (!wanted || !repo.local) {
      continue
    }
    const [name, email] = await Promise.all([
      deps.readLocal(repo.path, 'user.name'),
      deps.readLocal(repo.path, 'user.email')
    ])
    if (name === wanted.author.name && email === wanted.author.email) {
      continue
    }
    await deps.writeLocal(repo.path, 'user.name', wanted.author.name)
    await deps.writeLocal(repo.path, 'user.email', wanted.author.email)
    changes.push({ path: repo.path, space: wanted.space, from: email, to: wanted.author.email })
  }
  return changes
}

export function startHqSpaceGitAuthors(deps: HqSpaceGitDeps): () => void {
  const run = (): void =>
    void applyHqSpaceGitAuthors(deps)
      .then((changes) => {
        for (const change of changes) {
          console.info(
            `[hq-space-git] ${change.path}: ${change.from ?? 'global'} → ${change.to} (${change.space})`
          )
        }
      })
      .catch((error: unknown) =>
        console.warn('[hq-space-git] failed:', error instanceof Error ? error.message : error)
      )
  run()
  const timer = setInterval(run, REFRESH_MS)
  timer.unref?.()
  return () => clearInterval(timer)
}
