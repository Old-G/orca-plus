import { automationCanonicalLaunchSetup } from './automation-canonical-launch-setup'
import { automationLaunchInputs } from './automation-launch-choices'
import type { Automation } from '../automation-definition'
import {
  EXTRA_AGENT_ARGS_REQUIRE_FRESH_SESSION,
  hasExtraAgentArgs,
  parseExtraAgentArgs
} from '../../agent-launch/startup/automation-extra-agent-args'

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
const NARROWS_TOOLS: ReadonlySet<string> = new Set([
  '--no-chrome',
  '--strict-mcp-config',
  '--disallowedtools',
  '--disallowed-tools'
])

export const AUTOMATION_NARROWED_TOOLS_STAY_IN_TERMINAL =
  'This automation narrows its tools (--no-chrome, --strict-mcp-config or --disallowed-tools), which only a terminal run keeps. Remove them before opening it in a chat.'

/** Whether the extras take tools away from the run. Why the parsed tokens (Codex 03.11): the parser
 *  accepts a quoted `'--no-chrome'`, which the raw text would not show. */
export function narrowsAutomationTools(
  automation: Pick<Automation, 'agentId' | 'extraAgentArgs'>
): boolean {
  if (!hasExtraAgentArgs(automation.extraAgentArgs)) {
    return false
  }
  const parsed = parseExtraAgentArgs({
    agent: automation.agentId,
    extraAgentArgs: automation.extraAgentArgs
  })
  const tokens = parsed.ok
    ? parsed.tokens
    : automation.extraAgentArgs.split(/\s+/).map((token) => token.replace(/^['"]+|['"]+$/g, ''))
  return tokens.some((token) => NARROWS_TOOLS.has((token.split('=')[0] ?? '').toLowerCase()))
}

/** Validates a whole record, so a patch that only enables Reuse still sees stored extras. */
export function assertAutomationExtraAgentArgs(
  automation: Pick<
    Automation,
    | 'agentId'
    | 'extraAgentArgs'
    | 'reuseSession'
    | 'surface'
    | 'launchPreferences'
    | 'agentArgs'
    | 'launchSetup'
  >
): void {
  // Why (Codex 03.11): a chat would drop the narrowing and run with the tools the job excluded.
  if (automation.surface === 'chat' && narrowsAutomationTools(automation)) {
    throw new Error(AUTOMATION_NARROWED_TOOLS_STAY_IN_TERMINAL)
  }
  const setup = automationCanonicalLaunchSetup(automation)
  const views = automationLaunchInputs(automation.agentId, setup)
  const consumed =
    setup.surface === 'chat'
      ? Object.keys(views.chatSessionOptions ?? {}).length > 0
      : setup.agentArgs !== undefined || Object.keys(views.sessionOptions ?? {}).length > 0
  if (automation.reuseSession && consumed) {
    throw new Error('Agent launch settings require a fresh session for every run.')
  }
  if (setup.surface === 'chat' || !hasExtraAgentArgs(setup.extraAgentArgs)) {
    return
  }
  if (automation.reuseSession) {
    throw new Error(EXTRA_AGENT_ARGS_REQUIRE_FRESH_SESSION)
  }
  const parsed = parseExtraAgentArgs({
    agent: automation.agentId,
    extraAgentArgs: setup.extraAgentArgs
  })
  if (!parsed.ok) {
    throw new Error(parsed.error)
  }
}
