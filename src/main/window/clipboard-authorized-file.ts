import { stat } from 'node:fs/promises'
import type { Store } from '../persistence'
import { PATH_ACCESS_DENIED_MESSAGE, resolveAuthorizedPath } from '../ipc/filesystem-auth'
import { isENOENT } from '../ipc/filesystem-path-containment'
import type { ClipboardFileDeps } from './clipboard-file-copy'

// Same authorization the upstream `clipboard:writeFile` handler applies inline:
// the path must be inside an allowed root and exist.
export function resolveAuthorizedClipboardFile(store: Store): ClipboardFileDeps['resolveFilePath'] {
  return async (path) => {
    try {
      const authorizedPath = await resolveAuthorizedPath(path, store)
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
