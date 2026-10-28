// Custom build (hq-plus-center-file): while HQ+ is on screen, a file opened from its chat or its project
// panel takes the center column in place of the feed, in Orca's own editor, instead of leaving for Code.
import type { ExecutionHostId } from '../../../../../shared/execution-host'
import { useAppStore } from '@/store'

type CenterFileListener = (worktreeId: string) => void

let listener: CenterFileListener | null = null

/** HQ+ registers while mounted; the returned function unregisters it. */
export function registerHqPlusCenterFile(next: CenterFileListener): () => void {
  listener = next
  return () => {
    if (listener === next) {
      listener = null
    }
  }
}

/** Shows the active file of this workspace in HQ+'s center; false when HQ+ is not on screen. */
export function openHqPlusCenterFile(worktreeId: string): boolean {
  if (!listener || useAppStore.getState().activeView !== 'hq') {
    return false
  }
  listener(worktreeId)
  return true
}

/**
 * A file link about to open: with HQ+ on screen its workspace becomes active without leaving HQ+, and
 * the file shows in the center once the editor opens it. False leaves the usual reveal in Code.
 */
export function takeHqPlusFileOpen(
  worktreeId: string,
  executionHostId: ExecutionHostId | null | undefined
): boolean {
  const state = useAppStore.getState()
  if (!listener || state.activeView !== 'hq') {
    return false
  }
  if (state.activeWorktreeId !== worktreeId) {
    state.setActiveWorktree(worktreeId, executionHostId ?? undefined)
  }
  return openHqPlusCenterFile(worktreeId)
}
