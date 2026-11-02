import type { Automation, AutomationRun } from '../../shared/automations-types'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { launchAgentOnHost } from '../runtime/rpc/methods/agent-launch'
import { reuseAutomationChat } from './automation-chat-session-reuse'
import { buildHeadlessAutomationWorkspaceName } from './headless-workspace-create'
import type { AutomationRunTargetResult } from './run-target-resolution'
import {
  AutomationRunLaunchError,
  type HeadlessAutomationDispatchLaunch
} from './headless-dispatch'
import {
  publishedLaunchTarget,
  enrichAutomationRunTarget,
  automationRunAcceptedTarget
} from './automation-agent-run-result'
import { automationRunOperationId, AUTOMATION_AGENT_CALLER } from './automation-run-operation'
import { createAutomationDispatchToken } from './dispatch-tokens'
import { tuiAgentDisplayName } from '../../shared/tui-agent-display-names'
import {
  AUTOMATION_NARROWED_TOOLS_STAY_IN_TERMINAL,
  narrowsAutomationTools
} from '../../shared/automation-extra-agent-args-record'

export type AutomationChatAgentLaunch = HeadlessAutomationDispatchLaunch & {
  terminalHandle: string | null
}

export type AutomationChatLaunchRequest = {
  automation: Automation
  run: Pick<AutomationRun, 'id' | 'title' | 'scheduledFor' | 'createdAt'>
  target: Extract<AutomationRunTargetResult, { ok: true }>
  runs: readonly AutomationRun[]
}

/** Custom build (automations-chat-model, owner 02.11): a chat takes the automation's `--model` and
 *  `--effort` as its own options, so a run moved from the terminal keeps its model (sonnet stays sonnet). */
export function chatSessionOptions(
  args: string | undefined
): { sessionOptions: { model?: string; effort?: string } } | Record<string, never> {
  const options: { model?: string; effort?: string } = {}
  const words = (args ?? '').trim().split(/\s+/).filter(Boolean)
  for (let index = 0; index < words.length; index += 1) {
    const [flag, inline] = (words[index] ?? '').split('=', 2)
    const value = inline ?? words[index + 1]
    if ((flag === '--model' || flag === '--effort') && value && !value.startsWith('-')) {
      options[flag === '--model' ? 'model' : 'effort'] = value
      if (inline === undefined) {
        index += 1
      }
    }
  }
  return options.model || options.effort ? { sessionOptions: options } : {}
}

export async function launchAutomationChatAgent(
  runtime: OrcaRuntimeService,
  request: AutomationChatLaunchRequest
): Promise<AutomationChatAgentLaunch> {
  try {
    return await enrichAutomationRunTarget(runtime, await launchChat(runtime, request))
  } catch (error) {
    if (error instanceof AutomationRunLaunchError) {
      throw error
    }
    console.error('[automations] chat launch failed:', error)
    throw new Error(
      `${tuiAgentDisplayName(request.automation.agentId) ?? 'The agent'} could not confirm this run's prompt. Open its workspace before running again.`
    )
  }
}

async function launchChat(
  runtime: OrcaRuntimeService,
  request: AutomationChatLaunchRequest
): Promise<AutomationChatAgentLaunch> {
  const { automation, run, target } = request
  // Why (Codex 03.11): a record saved before the check, or edited around it, must not run in a chat
  // with the tools its terminal run excluded.
  if (narrowsAutomationTools(automation)) {
    throw new AutomationRunLaunchError(AUTOMATION_NARROWED_TOOLS_STAY_IN_TERMINAL)
  }
  let published: AutomationChatAgentLaunch | undefined
  if (automation.reuseSession && automation.workspaceId) {
    const reused = await reuseAutomationChat(runtime, request)
    if (reused) {
      return reused
    }
  }
  const operationId = automationRunOperationId(run, 'fresh-launch')
  try {
    const result = await launchAgentOnHost(
      {
        agent: automation.agentId,
        operationId,
        surface: 'chat',
        presentation: 'background',
        ...chatSessionOptions(automation.extraAgentArgs),
        prompt: { text: automation.prompt, delivery: 'submit' },
        target:
          automation.workspaceMode === 'existing'
            ? { kind: 'existing', worktree: `id:${automation.workspaceId}` }
            : {
                kind: 'create-worktree',
                create: {
                  repo: `id:${target.repo.id}`,
                  name: buildHeadlessAutomationWorkspaceName(run.title, run.scheduledFor),
                  ...(automation.baseBranch ? { baseBranch: automation.baseBranch } : {}),
                  setupDecision: automation.setupDecision ?? 'skip',
                  activate: false,
                  automationProvenanceRequest: {
                    automationId: automation.id,
                    automationRunId: run.id,
                    dispatchToken: createAutomationDispatchToken(automation.id, run.id),
                    createRequestId: operationId
                  }
                }
              }
      },
      { runtime, caller: AUTOMATION_AGENT_CALLER },
      {
        onSurfacePublished: (surface) => {
          published = publishedLaunchTarget(runtime, surface)
        }
      }
    )
    if (result.prompt?.outcome !== 'journaled' && result.prompt?.outcome !== 'handed-to-terminal') {
      throw new AutomationRunLaunchError(
        `${tuiAgentDisplayName(automation.agentId)} started, but Orca could not confirm this run's prompt. Open the run before trying again.`,
        published ?? publishedLaunchTarget(runtime, result)
      )
    }
    return publishedLaunchTarget(runtime, result)
  } catch (error) {
    if (
      error instanceof Error &&
      ('code' in error
        ? error.code === 'agent_session_operation_expired'
        : error.message.includes('agent_session_operation_expired'))
    ) {
      throw new AutomationRunLaunchError(
        `${tuiAgentDisplayName(automation.agentId)} could not start because this run waited too long. Run the automation again.`
      )
    }
    return automationRunAcceptedTarget(runtime, run, published, error, automation.agentId)
  }
}
