import { useEffect } from 'react'
import { useAppStore, type AppState } from '@/store'
import { handleAutomationDispatchRequest } from './automation-dispatch-handler'

export function useAutomationDispatchEvents(): void {
  useEffect(() => {
    const unsubscribe = window.api.automations.onDispatchRequested(handleAutomationDispatchRequest)
    const stopWaiting = reportReadyOnceWorkspaceSessionHydrates()
    return () => {
      stopWaiting()
      unsubscribe()
    }
  }, [])
}

// Why: main dispatches due runs the moment the renderer reports ready. Before the workspace
// session hydrates the repo list is empty, and until the startup worktree refresh finishes a
// project with no open tabs has no worktree rows, so a missed run caught up at launch was refused
// as "The target project/workspace is no longer available." No timeout: a late ready only delays the run.
function isReadyForDispatch(state: AppState): boolean {
  return state.workspaceSessionReady && state.startupWorktreeRefreshCompleted
}

function reportReadyOnceWorkspaceSessionHydrates(): () => void {
  if (isReadyForDispatch(useAppStore.getState())) {
    void window.api.automations.rendererReady()
    return () => {}
  }
  const unsubscribe = useAppStore.subscribe((state) => {
    if (isReadyForDispatch(state)) {
      unsubscribe()
      void window.api.automations.rendererReady()
    }
  })
  return unsubscribe
}
