import type { HqChatRole } from '../../../../shared/hq-chat-role'

const CLAUDE_ARTIFACT_ENV = 'CLAUDE_CODE_ARTIFACT'

// SDK entrypoints hide Claude's Artifact tools unless this is set; a user value still wins,
// matched case-insensitively on Windows, where claude_code_artifact=0 is the same opt-out.
export function withClaudeArtifactDefault(
  env: Record<string, string>,
  platform: NodeJS.Platform = process.platform
): Record<string, string> {
  const chosen = Object.keys(env).some(
    (key) =>
      key === CLAUDE_ARTIFACT_ENV ||
      (platform === 'win32' && key.toUpperCase() === CLAUDE_ARTIFACT_ENV)
  )
  return chosen ? env : { ...env, [CLAUDE_ARTIFACT_ENV]: '1' }
}

// Custom build (context-diet T1, owner 25.11): the Artifact tool and its instructions cost ~12k tokens
// on every call, and only a lead or a chat the owner talks to publishes pages. A worker, review or
// sub-lead chat starts with CLAUDE_CODE_ARTIFACT=0 in --settings: settings.json `env` beats a process
// variable, so the process env above cannot do this.
const ARTIFACT_OFF_ROLES: readonly HqChatRole[] = ['worker', 'review', 'sublead']

export function claudeArtifactSettingsForRole(
  role: HqChatRole | null
): { env: Record<string, string> } | null {
  return role && ARTIFACT_OFF_ROLES.includes(role) ? { env: { [CLAUDE_ARTIFACT_ENV]: '0' } } : null
}
