import { homedir } from 'node:os'
import { isAbsolute, join, normalize } from 'node:path'
import {
  BASE_CLAUDE_SUBSCRIPTION_ID,
  type ClaudeSubscription
} from '../../shared/claude-subscriptions'
import type { GlobalSettings } from '../../shared/global-settings-types'
import { describeUnusableClaudeSubscriptionDir } from './claude-subscription-home'

/** `~/x` → absolute; trailing separators dropped. The result is what the CLI keys its keychain
 *  item on, so it must be the same string every launch. */
export function normalizeClaudeSubscriptionConfigDir(
  value: string,
  home: string = homedir()
): string | null {
  const trimmed = value.trim()
  const expanded =
    trimmed === '~' ? home : trimmed.startsWith('~/') ? join(home, trimmed.slice(2)) : trimmed
  if (!expanded || !isAbsolute(expanded)) {
    return null
  }
  const normalized = normalize(expanded).replace(/[\\/]+$/, '')
  return describeUnusableClaudeSubscriptionDir(normalized, { home }) ? null : normalized
}

/** Drops malformed rows, duplicate ids and duplicate dirs; the base sign-in is never a row. */
export function normalizeClaudeSubscriptions(
  value: unknown,
  home: string = homedir()
): ClaudeSubscription[] {
  if (!Array.isArray(value)) {
    return []
  }
  const result: ClaudeSubscription[] = []
  for (const row of value) {
    if (!row || typeof row !== 'object') {
      continue
    }
    const id = 'id' in row ? row.id : undefined
    const label = 'label' in row ? row.label : undefined
    const configDir = 'configDir' in row ? row.configDir : undefined
    if (typeof id !== 'string' || typeof label !== 'string' || typeof configDir !== 'string') {
      continue
    }
    const cleanId = id.trim()
    const dir = normalizeClaudeSubscriptionConfigDir(configDir, home)
    if (
      !/^[A-Za-z0-9_-]{1,64}$/.test(cleanId) ||
      cleanId === BASE_CLAUDE_SUBSCRIPTION_ID ||
      !label.trim() ||
      !dir ||
      result.some((existing) => existing.id === cleanId || existing.configDir === dir)
    ) {
      continue
    }
    result.push({ id: cleanId, label: label.trim().slice(0, 80), configDir: dir })
  }
  return result
}

/** A default that names no subscription becomes the base sign-in. */
export function normalizeDefaultClaudeSubscriptionId(
  value: unknown,
  subscriptions: readonly ClaudeSubscription[]
): string | null {
  return typeof value === 'string' &&
    subscriptions.some((subscription) => subscription.id === value)
    ? value
    : null
}

/** The `settings:set` slice for subscriptions: a renderer path never reaches the CLI unchecked. */
export function normalizeClaudeSubscriptionSettingsUpdate(
  update: Partial<Pick<GlobalSettings, 'claudeSubscriptions' | 'defaultClaudeSubscriptionId'>>,
  current: Pick<GlobalSettings, 'claudeSubscriptions' | 'defaultClaudeSubscriptionId'>
): Pick<GlobalSettings, 'claudeSubscriptions' | 'defaultClaudeSubscriptionId'> {
  const subscriptions =
    'claudeSubscriptions' in update
      ? normalizeClaudeSubscriptions(update.claudeSubscriptions)
      : [...(current.claudeSubscriptions ?? [])]
  return {
    claudeSubscriptions: subscriptions,
    defaultClaudeSubscriptionId: normalizeDefaultClaudeSubscriptionId(
      'defaultClaudeSubscriptionId' in update
        ? update.defaultClaudeSubscriptionId
        : current.defaultClaudeSubscriptionId,
      subscriptions
    )
  }
}
