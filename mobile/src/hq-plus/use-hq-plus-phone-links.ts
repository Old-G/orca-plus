// Custom build (hq-plus-phone): a link from a card, opened where the owner picks — Orca's browser in
// the HQ workspace (a tab on the Mac the phone's session screen streams), Safari, or the clipboard.
import { useCallback, useRef } from 'react'
import { useRouteHandoff } from '../navigation/route-handoff'
import { useClipboardWriter } from '../platform/clipboard'
import { openExternalLink } from '../platform/external-link'
import { runRpcOperation } from '../transport/rpc-operation'
import type { RpcClient } from '../transport/rpc-client'
import { errorText } from '../hq/use-mobile-hq-poll'
import { hqPlusBrowserOpen, hqPlusWorktreesRead } from './hq-plus-phone-operations'
import type { HqpLinkChoice } from './MobileHqPlusLinkSheet'

type HqWorkspace = { worktreeId: string; repo: string }

function samePath(a: string, b: string): boolean {
  return a.replace(/[\\/]+$/, '') === b.replace(/[\\/]+$/, '')
}

export function useHqPlusPhoneLinks({
  client,
  hostId,
  hqPath,
  onNotice
}: {
  client: RpcClient | null
  hostId: string | undefined
  hqPath: string | null
  onNotice: (text: string) => void
}): (url: string, choice: HqpLinkChoice) => void {
  const router = useRouteHandoff()
  const clipboard = useClipboardWriter()
  const hqWorkspace = useRef<HqWorkspace | null>(null)

  const findHq = useCallback(async (): Promise<HqWorkspace | null> => {
    if (hqWorkspace.current || !client || !hqPath) {
      return hqWorkspace.current
    }
    const { worktrees } = await runRpcOperation(client, hqPlusWorktreesRead, {})
    const found = worktrees.find((worktree) => samePath(worktree.path, hqPath)) ?? null
    hqWorkspace.current = found ? { worktreeId: found.worktreeId, repo: found.repo } : null
    return hqWorkspace.current
  }, [client, hqPath])

  return useCallback(
    (url: string, choice: HqpLinkChoice) => {
      if (choice === 'safari') {
        openExternalLink(url)
        return
      }
      if (choice === 'copy') {
        void clipboard
          .writeText(url)
          .then(() => onNotice('Link copied'))
          .catch((error: unknown) => onNotice(errorText(error)))
        return
      }
      void (async () => {
        try {
          const hq = await findHq()
          if (!client || !hostId || !hq) {
            onNotice('HQ is not a workspace in Orca on the Mac; opened in Safari.')
            openExternalLink(url)
            return
          }
          await runRpcOperation(client, hqPlusBrowserOpen, {
            worktree: `id:${hq.worktreeId}`,
            url,
            activate: true
          })
          router.push(
            `/h/${encodeURIComponent(hostId)}/session/${encodeURIComponent(hq.worktreeId)}?name=${encodeURIComponent(hq.repo)}`
          )
        } catch (error) {
          onNotice(errorText(error))
        }
      })()
    },
    [client, clipboard, findHq, hostId, onNotice, router]
  )
}
