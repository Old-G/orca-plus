// Custom build (hq-task-questions): HQ drafts questions to a ClickUp task's author with one short
// Claude run. The task text is written by others, so Claude runs with no tools and no MCP servers.
import type { GlobalSettings } from '../../shared/settings/global-settings-types'
import {
  hqTaskQuestionsPrompt,
  restoreFirstQuestionNumber,
  type HqTaskQuestionsResult
} from '../../shared/hq-triage'
import type { ResolvedSourceControlAiGenerationParams } from '../../shared/source-control/ai/source-control-ai-operation-resolution'
import { resolveGenerationTarget } from '../agent-hooks/first-work/first-work-generation-target'
import type { CommitMessageAgentEnvironmentResolvers } from '../text-generation/execution/commit-message-agent-environment'
import { resolveCommitMessageSettings as resolveTextGenerationParams } from '../text-generation/commit-message-text-generation'
import { spawnSourceControlAgent } from '../text-generation/execution/source-control-agent-launch'
import { runGenerationRequest } from '../text-generation/agent-generation-request'
import { CLAUDE_TEXT_GENERATION_TOOLS } from '../../shared/text-generation/launch/claude-background-run-isolation'
import { HQ_LEAN_ARGS, HQ_LEAN_OPERATIONS, shouldRetryLeanRunInFull } from './hq-background-lean'

const FALLBACK_MODEL = 'sonnet'
// Why: tools would let text in the task read files or reach the network on this Mac. Text
// generation now grants Read/Grep/Glob itself, and repeated --tools add up, so the deny rule
// (which outranks every allow) is what keeps the run tool-less.
const NO_TOOLS_ARGS = `--tools "" --disallowedTools ${CLAUDE_TEXT_GENERATION_TOOLS.join(',')} --strict-mcp-config`

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
      | 'hq-ledger-guess'
      | 'hq-in-work'
      | 'hq-ledger-draft'
      | 'hq-ledger-promises'
      | 'hq-effort-pick'
    /** Custom build (hq-clickup-triage): a cheaper model than the one set for HQ text. */
    model?: string
    /** Custom build (google-disconnect-forget): the run leaves no transcript on disk — its input is
     *  Google user data, which Orca+ must not keep past a disconnect. */
    noTranscript?: true
  },
  deps: HqTextGenerationDeps
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const base = hqTaskQuestionsParams(deps.settings)
  const params = {
    ...base,
    ...(what.model ? { model: what.model } : {}),
    ...(what.noTranscript ? { agentArgs: `${base.agentArgs} --no-session-persistence` } : {})
  }
  const target = await resolveGenerationTarget(deps.cwd, params.agentId, deps)
  if (!target) {
    return { ok: false, error: 'Could not prepare the Claude environment.' }
  }
  const run = (agentArgs: string | undefined) =>
    runGenerationRequest({
      params: { ...params, agentArgs },
      prompt,
      target,
      operation: what.operation,
      spawnAgent: spawnSourceControlAgent
    })
  // Custom build (hq-background-lean): a classifier starts bare; texts people read keep the full launch.
  const lean = HQ_LEAN_OPERATIONS.has(what.operation)
  let result = await run(lean ? `${params.agentArgs} ${HQ_LEAN_ARGS}` : params.agentArgs)
  if (lean && !result.success && shouldRetryLeanRunInFull(result.failureOutput)) {
    const reason = (result.failureOutput?.stderr || result.failureOutput?.stdout || '').trim()
    console.warn(
      `[hq-lean] ${what.operation}: lean run refused, full launch once:`,
      reason.slice(0, 200)
    )
    result = await run(params.agentArgs)
  }
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
