// Custom build (hq-task-questions): HQ drafts questions to a ClickUp task's author with one short
// Claude run. The task text is written by others, so Claude runs with no tools and no MCP servers.
import type { GlobalSettings } from '../../shared/global-settings-types'
import {
  hqTaskQuestionsPrompt,
  restoreFirstQuestionNumber,
  type HqTaskQuestionsResult
} from '../../shared/hq-triage'
import { planCommitMessageGeneration } from '../../shared/commit-message-plan'
import type { ResolvedSourceControlAiGenerationParams } from '../../shared/source-control-ai'
import { resolveGenerationTarget } from '../agent-hooks/first-work-generation-target'
import type { CommitMessageAgentEnvironmentResolvers } from '../text-generation/commit-message-agent-environment'
import { resolveTextGenerationParams } from '../text-generation/commit-message-text-generation'
import { spawnSourceControlAgent } from '../text-generation/source-control-agent-launch'
import { executeGenerationPlan } from '../text-generation/source-control-text-generation-requests'

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

export async function draftHqTaskQuestions(
  task: { identifier: string; title: string; description: string },
  deps: {
    settings: GlobalSettings
    cwd: string
    getAgentEnvResolvers: () => CommitMessageAgentEnvironmentResolvers | undefined
  }
): Promise<HqTaskQuestionsResult> {
  const params = hqTaskQuestionsParams(deps.settings)
  const planned = planCommitMessageGeneration(
    {
      agentId: params.agentId,
      model: params.model,
      ...(params.thinkingLevel ? { thinkingLevel: params.thinkingLevel } : {}),
      ...(params.agentCommandOverride ? { agentCommandOverride: params.agentCommandOverride } : {}),
      ...(params.agentArgs ? { agentArgs: params.agentArgs } : {})
    },
    hqTaskQuestionsPrompt(task)
  )
  if (!planned.ok) {
    return { ok: false, error: planned.error }
  }
  const target = await resolveGenerationTarget(deps.cwd, params.agentId, null, deps)
  if (!target) {
    return { ok: false, error: 'Could not prepare the Claude environment.' }
  }
  const result = await executeGenerationPlan({
    params,
    plan: planned.plan,
    target,
    emptyResultName: 'list of questions',
    operation: 'hq-task-questions',
    spawnAgent: spawnSourceControlAgent
  })
  return result.success
    ? { ok: true, questions: restoreFirstQuestionNumber(result.rawOutput.trim()) }
    : { ok: false, error: result.error }
}
