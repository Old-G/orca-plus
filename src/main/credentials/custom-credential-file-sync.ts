// Custom build (clickup-core, slack-core, hq-slack-reader): upstream's credential file I/O went async
// and ordered per file (#44661). Our ClickUp and Slack stores keep a synchronous status read, and
// remove their files in each file's write order so a write still in flight cannot land after a delete.
import { statSync } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { inCredentialFileOrder } from './credential-file-io'

/** An empty file means no saved credential, as upstream's async credentialFileHasContent says. */
export function credentialFileHasContentSync(path: string): boolean {
  try {
    return statSync(path).size > 0
  } catch {
    return false
  }
}

export async function removeCredentialFilesInOrder(paths: readonly string[]): Promise<void> {
  for (const path of paths) {
    await inCredentialFileOrder(path, async () => {
      try {
        await unlink(path)
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
          throw error
        }
      }
    })
  }
}
