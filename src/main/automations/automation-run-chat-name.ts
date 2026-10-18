// Custom build (automations-native-chat): a fresh automation chat is named after its run; otherwise
// the chat is named after the prompt's first line.
import type { AgentLaunchResult } from '../../shared/agent-launch/contracts/agent-launch-intent'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'

export async function nameAutomationRunChat(
  runtime: Pick<OrcaRuntimeService, 'setMobileSessionTabProps'>,
  result: Pick<AgentLaunchResult, 'worktreeId' | 'outcome'>,
  title: string
): Promise<void> {
  const customTitle = title.trim()
  if (result.outcome.kind !== 'structured' || !result.outcome.tabId || !customTitle) {
    return
  }
  try {
    await runtime.setMobileSessionTabProps(`id:${result.worktreeId}`, {
      tabId: result.outcome.tabId,
      customTitle
    })
  } catch (error) {
    // Why: the name is cosmetic; the run already launched and must not fail over it.
    console.warn('[automations] could not name the run chat:', error)
  }
}
