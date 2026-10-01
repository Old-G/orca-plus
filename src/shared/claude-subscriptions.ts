import { CLAUDE_SUBSCRIPTIONS_ENABLED } from './claude-subscriptions-switch'

/**
 * A Claude subscription a session can run on: its own CLAUDE_CONFIG_DIR with its own
 * `claude auth login`. Orca never reads or copies the tokens — the CLI keeps them in
 * the keychain item derived from the directory path.
 */
export type ClaudeSubscription = {
  id: string
  label: string
  /** Absolute path, verbatim: the CLI keys its keychain item on the literal string. */
  configDir: string
}

/** Who a subscription dir is signed in as, from `claude auth status --json`. */
export type ClaudeSubscriptionStatus = {
  loggedIn: boolean
  email?: string
  orgName?: string
  subscriptionType?: string
}

/** The plain `~/.claude` sign-in, including Orca's managed account switching. */
export const BASE_CLAUDE_SUBSCRIPTION_ID = 'base'

/** Launch-env marker naming the session's subscription; it rides in persisted agent env so a
 *  resumed pane stays on the subscription it started on. */
export const CLAUDE_SUBSCRIPTION_ENV = 'ORCA_CLAUDE_SUBSCRIPTION'

/** `agent.launch` session option naming a Claude launch's subscription (`orca agent launch
 *  --subscription`); both launch surfaces read it, structured option narrowing drops it. */
export const CLAUDE_SUBSCRIPTION_SESSION_OPTION = 'claudeSubscription'

/** The GlobalSettings slice for subscriptions. */
export type ClaudeSubscriptionSettings = {
  /** Extra Claude sign-ins, each its own CLAUDE_CONFIG_DIR; a session picks one at launch. */
  claudeSubscriptions?: readonly ClaudeSubscription[]
  /** Subscription new Claude sessions use; null/absent = the base `~/.claude` sign-in. */
  defaultClaudeSubscriptionId?: string | null
}

/**
 * The config dir a Claude launch should pin, or null for the base `~/.claude`.
 * An unknown id (the subscription was removed) falls back to the base sign-in rather than
 * the default, so a resumed session never silently changes organization twice.
 */
export function resolveClaudeSubscriptionConfigDir(
  settings: ClaudeSubscriptionSettings | null | undefined,
  requestedId: string | null | undefined
): string | null {
  if (!CLAUDE_SUBSCRIPTIONS_ENABLED) {
    return null
  }
  const subscriptions = settings?.claudeSubscriptions ?? []
  const id = requestedId?.trim() || settings?.defaultClaudeSubscriptionId || null
  if (!id || id === BASE_CLAUDE_SUBSCRIPTION_ID) {
    return null
  }
  return subscriptions.find((subscription) => subscription.id === id)?.configDir ?? null
}

/** Which subscription a launch env names, if any. */
export function readClaudeSubscriptionFromEnv(
  env: Readonly<Record<string, string | undefined>> | null | undefined
): string | null {
  return env?.[CLAUDE_SUBSCRIPTION_ENV]?.trim() || null
}

/**
 * Stamps a Claude launch's env with its subscription — the picked one, else today's default — so
 * the pane's persisted launch env resumes on the same sign-in after the default changes.
 */
export function withClaudeSubscriptionLaunchEnv(
  agent: string,
  env: Record<string, string>,
  settings: ClaudeSubscriptionSettings | null | undefined,
  pickedId: string | undefined
): Record<string, string> {
  if (
    !CLAUDE_SUBSCRIPTIONS_ENABLED ||
    agent !== 'claude' ||
    (settings?.claudeSubscriptions ?? []).length === 0
  ) {
    return env
  }
  if (env.CLAUDE_CONFIG_DIR?.trim()) {
    return env
  }
  const id = pickedId ?? settings?.defaultClaudeSubscriptionId ?? BASE_CLAUDE_SUBSCRIPTION_ID
  return { ...env, [CLAUDE_SUBSCRIPTION_ENV]: id }
}
