// Custom build (outgoing-approval): tells native-chat children where the hook server's endpoint file is.
// Why a separate variable: ORCA_AGENT_HOOK_ENDPOINT in a pane-less child would make the status hook spool.
import { ORCA_OUTGOING_GATE_ENDPOINT_ENV } from './outgoing-gate-hook-script'

let readEndpointPath: (() => string | null) | null = null

export function bindOutgoingGateEndpoint(read: (() => string | null) | null): void {
  readEndpointPath = read
}

export function outgoingGateChildEnv(): Record<string, string> {
  const path = readEndpointPath?.()
  return path ? { [ORCA_OUTGOING_GATE_ENDPOINT_ENV]: path } : {}
}
