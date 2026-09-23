import { editorModelRegistry } from '@/lib/editor-model-registry'

// Renderer end of Orca's Claude Code IDE server (main/claude-ide). Mirrors what
// the VS Code extension listens to: selection and diagnostics; main polls folders.

function startMonacoTrackingWhenLoaded(unsubs: (() => void)[]): void {
  let stopTracking: (() => void) | null = null
  let disposed = false
  const start = (): void => {
    if (stopTracking || !editorModelRegistry.get()) {
      return
    }
    stopTracking = () => {}
    void import('./claude-ide-monaco-tracking').then(({ startClaudeIdeMonacoTracking }) => {
      stopTracking = disposed ? null : startClaudeIdeMonacoTracking()
    })
  }
  const unsubscribe = editorModelRegistry.subscribe(start)
  start()
  unsubs.push(() => {
    disposed = true
    unsubscribe()
    stopTracking?.()
  })
}

export function registerClaudeIdeIpcBridge(unsubs: (() => void)[]): void {
  const api = window.api.claudeIde
  if (!api) {
    // Web client: no local IDE server behind it.
    return
  }
  unsubs.push(
    api.onRequest(({ requestId, method, params }) => {
      void import('./claude-ide-request-handlers')
        .then(({ handleClaudeIdeRequest }) => handleClaudeIdeRequest(method, params))
        .then((text) => api.respond({ requestId, ok: true, text }))
        .catch((error: unknown) =>
          api.respond({
            requestId,
            ok: false,
            error: error instanceof Error ? error.message : String(error)
          })
        )
    })
  )
  startMonacoTrackingWhenLoaded(unsubs)
  void import('./claude-ide-diff-proposal-state').then(({ watchClosedClaudeProposals }) =>
    unsubs.push(watchClosedClaudeProposals())
  )
}
