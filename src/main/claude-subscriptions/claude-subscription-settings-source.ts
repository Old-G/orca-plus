// Custom build (claude-subscriptions): the settings RPC methods check `--subscription` against. Main
// registers the store at startup; the headless server (orcad) never does, and must not import
// Electron-bound state to find out.
import type { ClaudeSubscriptionSettings } from '../../shared/claude-subscriptions'

let source: (() => ClaudeSubscriptionSettings) | null = null

export function setClaudeSubscriptionSettingsSource(read: () => ClaudeSubscriptionSettings): void {
  source = read
}

/** Null when no store is registered (orcad): callers then accept the id as given. */
export function readClaudeSubscriptionSettings(): ClaudeSubscriptionSettings | null {
  return source?.() ?? null
}
