// Custom build (google-mcp): a bot method runs through Google's MCP server for its service. While the
// account's Google Cloud project has that MCP server turned off (a project set up before the move),
// the method runs on the REST API it used before, and tries MCP again a while later.
import type { GoogleApi } from './google-api-client'
import { GoogleToolError } from './google-api-client'
import type { GoogleMcpService } from './google-mcp-call'

const MCP_OFF_RETRY_MS = 10 * 60_000

/** Account and service → until when MCP is known to be off. At most accounts × five services. */
const mcpOffUntil = new Map<string, number>()

export async function viaGoogleMcp<T>(
  api: Pick<GoogleApi, 'email'>,
  service: GoogleMcpService,
  mcp: () => Promise<T>,
  rest: () => Promise<T>,
  now: () => number = Date.now
): Promise<T> {
  const key = `${api.email}\n${service}`
  if ((mcpOffUntil.get(key) ?? 0) > now()) {
    return rest()
  }
  try {
    const value = await mcp()
    mcpOffUntil.delete(key)
    return value
  } catch (error) {
    if (error instanceof GoogleToolError && error.mcpOff) {
      mcpOffUntil.set(key, now() + MCP_OFF_RETRY_MS)
      return rest()
    }
    throw error
  }
}
