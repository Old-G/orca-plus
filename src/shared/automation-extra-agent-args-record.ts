import type { Automation } from './automations-types'
import {
  EXTRA_AGENT_ARGS_REQUIRE_FRESH_SESSION,
  hasExtraAgentArgs,
  parseExtraAgentArgs
} from './automation-extra-agent-args'

/** Stored form of an extras input: the text unchanged, or `undefined` when it holds no extras. */
export function storedExtraAgentArgs(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined
  }
  if (typeof value !== 'string') {
    throw new Error('Extra agent arguments must be text.')
  }
  return hasExtraAgentArgs(value) ? value : undefined
}

/** Custom build (automation-narrow-tools): options that take tools away, which only a terminal run
 *  honours — a chat session takes no CLI flags. */
const NARROWS_TOOLS = /(?:^|\s)(?:--no-chrome|--strict-mcp-config|--disallowed-?tools)(?:[=\s]|$)/i

export const AUTOMATION_NARROWED_TOOLS_STAY_IN_TERMINAL =
  'This automation narrows its tools (--no-chrome, --strict-mcp-config or --disallowed-tools), which only a terminal run keeps. Remove them before opening it in a chat.'

/** Whether the extras take tools away from the run. */
export function narrowsAutomationTools(value: string | null | undefined): boolean {
  return NARROWS_TOOLS.test(value ?? '')
}

/** Validates a whole record, so a patch that only enables Reuse still sees stored extras. */
export function assertAutomationExtraAgentArgs(
  automation: Pick<Automation, 'agentId' | 'extraAgentArgs' | 'reuseSession' | 'surface'>
): void {
  // Why (Codex 03.11): a chat would drop the narrowing and run with the tools the job excluded.
  if (automation.surface === 'chat' && narrowsAutomationTools(automation.extraAgentArgs)) {
    throw new Error(AUTOMATION_NARROWED_TOOLS_STAY_IN_TERMINAL)
  }
  if (automation.surface === 'chat' || !hasExtraAgentArgs(automation.extraAgentArgs)) {
    return
  }
  if (automation.reuseSession) {
    throw new Error(EXTRA_AGENT_ARGS_REQUIRE_FRESH_SESSION)
  }
  const parsed = parseExtraAgentArgs({
    agent: automation.agentId,
    extraAgentArgs: automation.extraAgentArgs
  })
  if (!parsed.ok) {
    throw new Error(parsed.error)
  }
}
