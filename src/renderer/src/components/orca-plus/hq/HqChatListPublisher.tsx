// Custom build (hq-mobile-messenger): keeps the Mac's copy of HQ's chat list fresh for the phone,
// which has no dashboard of its own. Renders nothing; lives at the app root, apart from App's renders.
import { useEffect, useMemo } from 'react'
import { useNow } from '@/hooks/use-now'
import { isWebClientLocation } from '@/lib/web-client-location'
import { useAppStore } from '@/store'
import { splitHqActiveProjects } from './hq-active-projects'
import { groupHqChats } from './hq-chat-list'
import { buildHqChatWire } from './hq-chat-wire-build'
import { useHqChatList, useHqProjectColor } from './use-hq-chat-list'

const PUBLISH_DEBOUNCE_MS = 1_500
const NOW_TICK_MS = 5 * 60_000
const NO_KEPT: string[] = []

function Publisher(): null {
  const { items } = useHqChatList()
  const colorFor = useHqProjectColor()
  const now = useNow(NOW_TICK_MS)
  const kept = useAppStore((state) => state.settings?.hqKeptProjectIds) ?? NO_KEPT
  const generatedTitles = useAppStore((state) => state.settings?.tabAutoGenerateTitle === true)
  const wire = useMemo(() => {
    const split = splitHqActiveProjects(items, kept, now)
    const groups = { ...groupHqChats(items), quiet: split.quiet }
    return buildHqChatWire(groups, split.active, colorFor, generatedTitles)
  }, [items, kept, now, colorFor, generatedTitles])
  useEffect(() => {
    const timer = setTimeout(() => {
      void window.api.hqProjects.publishChatList?.(wire)?.catch(() => undefined)
    }, PUBLISH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [wire])
  return null
}

export function HqChatListPublisher(): React.JSX.Element | null {
  // Why: a paired web client is a reader; only the Mac's own window owns the list.
  return isWebClientLocation() ? null : <Publisher />
}
