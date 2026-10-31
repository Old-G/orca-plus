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

/** Custom build (hq-request-ledger): a finished call the sent-message hook reported. */
export type OutgoingSentReport = { hook: unknown; agentSessionId: string | null }

/** How long the sent-message hook waits for its message to reach the ledger; its curl allows 5 s. */
export const OUTGOING_SENT_WAIT_MS = 3_000

export function createOutgoingGateRequestHandler(
  gate: () => OutgoingApprovalGate,
  sent?: (report: OutgoingSentReport) => Promise<void>,
  sentWaitMs = OUTGOING_SENT_WAIT_MS
): OutgoingGateRequestHandler {
  return async (pathname, body, headers) => {
    const route = pathname.slice(OUTGOING_GATE_PATH_PREFIX.length)
    if (route === 'sent' && sent) {
      // Why: the agent's next step is often `orca pulse wait add`, which pairs with this send — so
      // the hook answers once it is in the ledger, but never later than SENT_WAIT_MS and never fails.
      const recording = sent({
        hook: body,
        agentSessionId: header(headers, 'x-orca-agent-session-id')
      }).catch((error: unknown) =>
        console.warn('[outgoing-approval] sent message not recorded:', error)
      )
      await Promise.race([
        recording,
        new Promise<void>((resolve) => setTimeout(resolve, sentWaitMs).unref?.())
      ])
      return 'ok\n'
    }
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
