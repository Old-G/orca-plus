// Custom build (hq-plus-room-mcp): which MCP servers a Claude chat starts without — its room's
// `mcp: { deny: [...] }`. HQ+ (a chat in the HQ repo) and a chat in no room keep every server; a chat
// already running keeps its tools until it restarts.
import { hqRoomMcpDenyRules } from '../../shared/hq-room-mcp'
import type { HqJournalService } from '../hq-journal/hq-journal-service'

export async function hqRoomDeniedTools(
  service: Pick<HqJournalService, 'space'> | null,
  chat: { sessionId: string; cwd: string },
  log: (message: string) => void = (message) => console.log('[hq-room-mcp]', message)
): Promise<string[]> {
  if (!service) {
    return []
  }
  try {
    const { scope, space } = await service.space({ sessionId: chat.sessionId, cwd: chat.cwd })
    const rules = hqRoomMcpDenyRules(space?.mcpDeny)
    if (rules.length > 0 && scope.kind === 'room') {
      log(`chat ${chat.sessionId} in room ${scope.room} starts without ${rules.join(', ')}`)
    }
    return rules
  } catch (error) {
    log(`room of chat ${chat.sessionId} unread, all servers kept: ${String(error)}`)
    return []
  }
}
