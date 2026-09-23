import { stat } from 'node:fs/promises'
import { PATH_ACCESS_DENIED_MESSAGE } from '../ipc/filesystem/access/filesystem-auth'
import { isENOENT } from '../filesystem/local-file-io/filesystem-path-containment'
import type { ClipboardFileDeps } from './clipboard/clipboard-file-copy'

// Same authorization the upstream `clipboard:writeFile` handler applies inline: the path must pass
// the core's local-path check (inside an allowed root) and exist.
export function resolveAuthorizedClipboardFile(
  authorizeLocalPath: (path: string) => Promise<string>
): ClipboardFileDeps['resolveFilePath'] {
  return async (path) => {
    try {
      const authorizedPath = await authorizeLocalPath(path)
      await stat(authorizedPath)
      return { ok: true, path: authorizedPath }
    } catch (error) {
      if (error instanceof Error && error.message === PATH_ACCESS_DENIED_MESSAGE) {
        return { ok: false, reason: 'access-denied' }
      }
      return { ok: false, reason: isENOENT(error) ? 'not-found' : 'invalid-path' }
    }
  }
}
