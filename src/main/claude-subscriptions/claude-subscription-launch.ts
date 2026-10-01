import {
  readClaudeSubscriptionFromEnv,
  resolveClaudeSubscriptionConfigDir,
  type ClaudeSubscriptionSettings
} from '../../shared/claude-subscriptions'
import {
  prepareClaudeSubscriptionHome,
  UnsafeClaudeSubscriptionDirError
} from './claude-subscription-home'

export type ClaudeSubscriptionLaunchInput = {
  settings: ClaudeSubscriptionSettings | null | undefined
  /** The launch's own env: its marker picks the subscription, its CLAUDE_CONFIG_DIR overrides all. */
  env: Readonly<Record<string, string | undefined>> | null | undefined
  /** Subscriptions are host directories; WSL launches keep their own resolution. Absent = host. */
  runtime: 'host' | 'wsl' | undefined
  /** Overrides the env marker (the native-chat create names its subscription directly). */
  subscriptionId?: string | null
  prepareHome?: (configDir: string) => void
}

/** The config dir a host Claude launch should pin for its subscription, or null to leave it be. */
export function resolveClaudeSubscriptionLaunchConfigDir(
  input: ClaudeSubscriptionLaunchInput
): string | null {
  if (input.runtime === 'wsl' || input.env?.CLAUDE_CONFIG_DIR?.trim()) {
    return null
  }
  const configDir = resolveClaudeSubscriptionConfigDir(
    input.settings,
    input.subscriptionId ?? readClaudeSubscriptionFromEnv(input.env)
  )
  if (!configDir) {
    return null
  }
  try {
    ;(input.prepareHome ?? prepareClaudeSubscriptionHome)(configDir)
  } catch (error) {
    if (error instanceof UnsafeClaudeSubscriptionDirError) {
      // Pinning it would point the CLI at someone else's folder; stay on the base sign-in.
      console.warn('[claude-subscriptions]', error.message)
      return null
    }
    // The sign-in still lives in this dir; a session without shared hooks beats one on the
    // wrong organization.
    console.warn('[claude-subscriptions] Could not prepare', configDir, error)
  }
  return configDir
}
