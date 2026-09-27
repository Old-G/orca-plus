import type { CommandHandler } from '../dispatch'
import { printResult } from '../format'
import { getOptionalStringFlag, getRequiredStringFlag } from '../flags'
import { RuntimeClientError } from '../runtime-client'
import { getRequiredWorktreeSelector } from '../selectors'
import { isTuiAgent } from '../../shared/tui-agent-config'
import type { AgentLaunchResult } from '../../shared/agent-launch-intent'

// A structured chat can take a while to start its SDK session; the 60 s default is too tight.
const AGENT_LAUNCH_TIMEOUT_MS = 120_000

export function formatAgentLaunch(result: AgentLaunchResult): string {
  const { outcome, receipt } = result
  const surface =
    outcome.kind === 'structured'
      ? `native chat (session ${outcome.sessionId})`
      : `terminal ${outcome.handle}`
  const lines = [
    `Started ${surface} in ${result.worktreeId}`,
    `Mode: ${receipt.mode} (default ${receipt.preferred}, ${receipt.reason}) — ${receipt.detail}`
  ]
  if (result.prompt) {
    lines.push(`Prompt: ${result.prompt.outcome}`)
  }
  if (result.warning) {
    lines.push(`Warning: ${result.warning}`)
  }
  return lines.join('\n')
}

export const AGENT_LAUNCH_HANDLERS: Record<string, CommandHandler> = {
  'agent launch': async ({ flags, client, cwd, json }) => {
    const agent = getRequiredStringFlag(flags, 'agent')
    if (!isTuiAgent(agent)) {
      throw new RuntimeClientError('invalid_argument', `Unknown agent: ${agent}`)
    }
    const worktree = await getRequiredWorktreeSelector(flags, 'worktree', cwd, client)
    const prompt = getOptionalStringFlag(flags, 'prompt')
    try {
      const result = await client.call<AgentLaunchResult>(
        'agent.launch',
        {
          agent,
          target: { kind: 'existing', worktree },
          ...(prompt ? { prompt: { text: prompt, delivery: 'submit' } } : {})
        },
        { timeoutMs: AGENT_LAUNCH_TIMEOUT_MS }
      )
      printResult(result, json, formatAgentLaunch)
    } catch (error) {
      // Why: a timeout does not mean the launch failed; a blind retry would start a second agent.
      if (error instanceof RuntimeClientError && error.code === 'runtime_timeout') {
        throw new RuntimeClientError(
          'runtime_timeout',
          'Orca did not answer in time; the agent may already be running. Check `orca worktree ps` before retrying.'
        )
      }
      throw error
    }
  }
}
