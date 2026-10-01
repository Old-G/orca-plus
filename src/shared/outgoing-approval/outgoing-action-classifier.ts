// Custom build (outgoing-approval): the one entry point main and tests use to decide whether a tool call is held.
import { readInputString, type OutgoingAction } from './outgoing-action'
import { classifyMcpCall, parseMcpToolName } from './outgoing-mcp-rules'
import { classifyShellCommand } from './outgoing-shell-rules'

export function classifyOutgoingToolCall(
  toolName: string,
  toolInput: unknown
): OutgoingAction | null {
  if (toolName === 'Bash') {
    return classifyShellCommand(readInputString(toolInput, 'command'))
  }
  const mcp = parseMcpToolName(toolName)
  return mcp ? classifyMcpCall(mcp, toolInput) : null
}
