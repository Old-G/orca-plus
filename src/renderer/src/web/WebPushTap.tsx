// Custom build (web-push): a tap on a bell push opens the web client with ?bell=<item>; this opens
// where that item leads once the workspaces are in.
import { useEffect } from 'react'
import type { PulseInboxItem } from '../../../shared/pulse-types'
import { WEB_PUSH_BELL_QUERY } from '../../../shared/web-push-tap'
import { openHqScreen } from '@/components/orca-plus/hq/hq-view'
import { openPulseBellItemTarget } from '@/components/orca-plus/pulse-bell/pulse-bell-actions'
import { useAppStore } from '@/store'
import { callRuntimeResult } from './preload-api/web-runtime-calls'

async function openBellItem(id: string): Promise<void> {
  const items = await callRuntimeResult<PulseInboxItem[]>('pulse.listInbox', { includeDone: true })
  const item = items.find((entry) => entry.id === id)
  // Why: the phone has no bell yet, so items with no place of their own land on HQ.
  if (!item || !openPulseBellItemTarget(item)) {
    openHqScreen('agents')
  }
}

export default function WebPushTap(): null {
  useEffect(() => {
    const url = new URL(window.location.href)
    const id = url.searchParams.get(WEB_PUSH_BELL_QUERY)
    if (!id) {
      return
    }
    url.searchParams.delete(WEB_PUSH_BELL_QUERY)
    window.history.replaceState(window.history.state, '', url.href)
    const open = (): void => {
      openBellItem(id).catch((error: unknown) =>
        console.warn('[web-push] tap target failed', error)
      )
    }
    if (useAppStore.getState().startupWorktreeRefreshCompleted) {
      open()
      return
    }
    const unsubscribe = useAppStore.subscribe((state) => {
      if (state.startupWorktreeRefreshCompleted) {
        unsubscribe()
        open()
      }
    })
    return unsubscribe
  }, [])
  return null
}
