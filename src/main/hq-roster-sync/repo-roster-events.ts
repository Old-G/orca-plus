// Custom build (hq-roster-sync): fires when the user adds a project to Orca or removes one.
// Why not a repo-list diff: a profile switch swaps the whole list and must not archive every page.
type RepoRosterListener = () => void

const listeners = new Set<RepoRosterListener>()

export function onRepoRosterChanged(listener: RepoRosterListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function emitRepoRosterChanged(): void {
  for (const listener of listeners) {
    try {
      listener()
    } catch (error) {
      // Why: a listener failure must never fail the add/remove the user asked for.
      console.error('[hq-roster-sync] listener failed:', error)
    }
  }
}
