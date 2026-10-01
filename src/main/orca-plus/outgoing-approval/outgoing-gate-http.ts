// Custom build (outgoing-approval): the hook server's /outgoing-gate/* routes. Replies are line-based so a
// POSIX sh hook can read them without a JSON parser: `pass`, `pending <id>`, or `final` + hook JSON.
import type { IncomingHttpHeaders } from 'node:http'
import type { GateReply, OutgoingApprovalGate } from './outgoing-approval-gate'

export const OUTGOING_GATE_PATH_PREFIX = '/outgoing-gate/'

export type OutgoingGateRequestHandler = (
  pathname: string,
  body: unknown,
  headers: IncomingHttpHeaders
) => Promise<string | null>

const FAILED_OUTPUT = {
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
    permissionDecisionReason:
      'Orca+ could not hold this outgoing action for approval, so it was not sent. Tell the user.'
  }
}

export function formatGateReply(reply: GateReply): string {
  switch (reply.state) {
    case 'pass':
      return 'pass\n'
    case 'pending':
      return `pending ${reply.id}\n`
    case 'final':
      return `final\n${JSON.stringify(reply.output)}\n`
  }
}

function header(headers: IncomingHttpHeaders, name: string): string | null {
  const value = headers[name]
  const first = Array.isArray(value) ? value[0] : value
  return first?.trim() ? first.trim() : null
}

export function createOutgoingGateRequestHandler(
  gate: () => OutgoingApprovalGate
): OutgoingGateRequestHandler {
  return async (pathname, body, headers) => {
    const route = pathname.slice(OUTGOING_GATE_PATH_PREFIX.length)
    if (route !== 'submit' && route !== 'wait') {
      return null
    }
    try {
      if (route === 'submit') {
        return formatGateReply(
          gate().submit({
            hook: body,
            agent: header(headers, 'x-orca-agent') ?? 'claude',
            paneKey: header(headers, 'x-orca-pane-key'),
            agentSessionId: header(headers, 'x-orca-agent-session-id')
          })
        )
      }
      const id = body && typeof body === 'object' ? Reflect.get(body, 'id') : null
      return formatGateReply(await gate().wait(typeof id === 'string' ? id : ''))
    } catch (error) {
      // Why: fail closed — an outgoing call Orca+ cannot hold must not go out unapproved.
      console.warn('[outgoing-approval] gate request failed:', error)
      return formatGateReply({ state: 'final', output: FAILED_OUTPUT })
    }
  }
}
