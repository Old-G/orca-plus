// Custom build (hq-task-questions): HQ drafts questions to a ClickUp task's author with one short
// Claude run. The task text is written by others, so Claude runs with no tools and no MCP servers.
import type { GlobalSettings } from '../../shared/global-settings-types'
import {
  hqTaskQuestionsPrompt,
  restoreFirstQuestionNumber,
  type HqTaskQuestionsResult
} from '../../shared/hq-triage'
import type { ResolvedSourceControlAiGenerationParams } from '../../shared/source-control-ai'
import { resolveGenerationTarget } from '../agent-hooks/first-work-generation-target'
import type { CommitMessageAgentEnvironmentResolvers } from '../text-generation/commit-message-agent-environment'
import { resolveTextGenerationParams } from '../text-generation/commit-message-text-generation'
import { spawnSourceControlAgent } from '../text-generation/source-control-agent-launch'
import { runGenerationRequest } from '../text-generation/agent-generation-request'

const FALLBACK_MODEL = 'sonnet'
// Why: tools would let text in the task read files or reach the network on this Mac.
const NO_TOOLS_ARGS = '--tools "" --strict-mcp-config'

/** Claude, with the model and command the user set for PR texts when that agent is Claude. */
export function hqTaskQuestionsParams(
  settings: GlobalSettings
): ResolvedSourceControlAiGenerationParams {
  const resolved = resolveTextGenerationParams(settings, 'local', 'pullRequest', null)
  const claude = resolved.ok && resolved.params.agentId === 'claude' ? resolved.params : null
  const override = claude?.agentCommandOverride ?? settings.agentCmdOverrides?.claude
  return {
    agentId: 'claude',
    model: claude?.model || FALLBACK_MODEL,
    ...(claude?.thinkingLevel ? { thinkingLevel: claude.thinkingLevel } : {}),
    ...(override ? { agentCommandOverride: override } : {}),
    agentArgs: NO_TOOLS_ARGS
  }
}

export type HqTextGenerationDeps = {
  settings: GlobalSettings
  cwd: string
  getAgentEnvResolvers: () => CommitMessageAgentEnvironmentResolvers | undefined
}

/** One short Claude run with no tools on text other people wrote; the raw answer, trimmed. */
export async function generateHqText(
  prompt: string,
  what: {
    emptyResultName: string
    operation:
      | 'hq-task-questions'
      | 'hq-clickup-reply'
      | 'hq-voice-rewrite'
      | 'hq-mr-watch'
      | 'hq-feed-posts'
      | 'hq-clickup-triage'
      | 'hq-slack-intake'
      | 'hq-reply-routing'
    /** Custom build (hq-clickup-triage): a cheaper model than the one set for HQ text. */
    model?: string
  },
  deps: HqTextGenerationDeps
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const base = hqTaskQuestionsParams(deps.settings)
  const params = what.model ? { ...base, model: what.model } : base
  const target = await resolveGenerationTarget(deps.cwd, params.agentId, deps)
  if (!target) {
    return { ok: false, error: 'Could not prepare the Claude environment.' }
  }
  const result = await runGenerationRequest({
    params,
    prompt,
    target,
    emptyResultName: what.emptyResultName,
    operation: what.operation,
    spawnAgent: spawnSourceControlAgent
  })
  return result.success
    ? { ok: true, text: result.rawOutput.trim() }
    : { ok: false, error: result.error }
}

export async function draftHqTaskQuestions(
  task: { identifier: string; title: string; description: string },
  deps: HqTextGenerationDeps
): Promise<HqTaskQuestionsResult> {
  const result = await generateHqText(
    hqTaskQuestionsPrompt(task),
    { emptyResultName: 'list of questions', operation: 'hq-task-questions' },
    deps
  )
  return result.ok ? { ok: true, questions: restoreFirstQuestionNumber(result.text) } : result
}
