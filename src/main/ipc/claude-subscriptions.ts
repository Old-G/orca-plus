// Custom build (claude-subscriptions): a Claude session runs on a chosen subscription — its own
// CLAUDE_CONFIG_DIR and `claude auth login`. The renderer names subscriptions by id only; the dir
// always comes from settings, never from the caller.
import { ipcMain } from 'electron'
import type { Store } from '../persistence'
import type { ClaudeSubscriptionStatus } from '../../shared/claude-subscriptions'
import {
  loginClaudeSubscription,
  readClaudeSubscriptionStatus
} from '../claude-subscriptions/claude-subscription-auth'
import { assignClaudeSubscriptionToSession } from '../claude-subscriptions/claude-subscription-session-assignments'
import { setClaudeSubscriptionSettingsSource } from '../claude-subscriptions/claude-subscription-settings-source'

function requireConfigDir(store: Store, id: unknown): string {
  const subscription = (store.getSettings().claudeSubscriptions ?? []).find(
    (candidate) => candidate.id === id
  )
  if (!subscription) {
    throw new Error('Unknown Claude subscription.')
  }
  return subscription.configDir
}

export function registerClaudeSubscriptionHandlers(store: Store): void {
  setClaudeSubscriptionSettingsSource(() => store.getSettings())
  ipcMain.handle(
    'claudeSubscriptions:status',
    (_event, args: { id: string }): Promise<ClaudeSubscriptionStatus> =>
      readClaudeSubscriptionStatus(requireConfigDir(store, args?.id))
  )
  ipcMain.handle(
    'claudeSubscriptions:login',
    (_event, args: { id: string }): Promise<ClaudeSubscriptionStatus> =>
      loginClaudeSubscription(requireConfigDir(store, args?.id))
  )
  ipcMain.handle(
    'claudeSubscriptions:assignSession',
    (_event, args: { sessionId: string; subscriptionId: string }): void => {
      if (typeof args?.sessionId === 'string' && typeof args.subscriptionId === 'string') {
        assignClaudeSubscriptionToSession(args.sessionId, args.subscriptionId)
      }
    }
  )
}
