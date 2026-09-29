// Custom build (native-chat-titles): transcript lookup for title requests that carry no path.
import type { AiVaultSessionTitleRequest } from '../../shared/ai-vault-session-title'
import { resolveSessionFilePath } from '../native-chat/session-file-resolver'

const MAX_REMEMBERED_PATHS = 500
const rememberedPaths = new Map<string, string>()

/** The session's transcript on this host, or null. A found path is remembered; a miss is retried next time. */
export async function resolveTitleTranscriptPath(
  request: AiVaultSessionTitleRequest,
  signal: AbortSignal | undefined
): Promise<string | null> {
  const key = `${request.agent}\0${request.sessionId}`
  const remembered = rememberedPaths.get(key)
  if (remembered) {
    return remembered
  }
  try {
    const path = await resolveSessionFilePath(request.agent, request.sessionId, {}, signal)
    if (path) {
      if (rememberedPaths.size >= MAX_REMEMBERED_PATHS) {
        rememberedPaths.delete(rememberedPaths.keys().next().value ?? '')
      }
      rememberedPaths.set(key, path)
    }
    return path
  } catch {
    return null
  }
}
