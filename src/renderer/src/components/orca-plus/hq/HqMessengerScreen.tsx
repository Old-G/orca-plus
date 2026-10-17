// Custom build (hq-chats): HQ's messenger view — on the left the pinned items (the earlier tabs) and
// every agent chat by what it needs; on the right the chosen one: a live chat, answered without
// leaving HQ, or a pinned item's page. Narrow screens show one side at a time.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MessagesSquare } from 'lucide-react'
import { useNow } from '@/hooks/use-now'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { isWebClientLocation } from '@/lib/web-client-location'
import { cn } from '@/lib/utils'
import WebPushPrompt from '@/web/WebPushPrompt'
import {
  acknowledgeHqChat,
  acknowledgeHqChats,
  openHqChatInProject,
  setHqProjectKept,
  setShownHqChat
} from './hq-chat-actions'
import { rememberHqChat, rememberedHqChat } from './hq-chat-open'
import { splitHqActiveProjects } from './hq-active-projects'
import { groupHqChats, hqChatTabId, nextHqWaitingChat, pickHqChat } from './hq-chat-list'
import {
  hqSelectionForRequest,
  rememberHqSelection,
  rememberedHqSelection,
  type HqPinnedId,
  type HqSelection
} from './hq-messenger-selection'
import { onHqTabRequested, takeRequestedHqTab } from './hq-view'
import { closeFinishedPulseBellItemsForHqChat } from '../pulse-bell/pulse-bell-actions'
import { HqChatList } from './HqChatList'
import { HqChatPane } from './HqChatPane'
import { HqContextPanel } from './HqContextPanel'
import { HqPinnedList } from './HqPinnedList'
import { HqPinnedPane } from './HqPinnedPane'
import { HqViewSwitch } from './HqViewSwitch'
import { useHqChatList, useHqProjectColor } from './use-hq-chat-list'
import { useHqPinnedNotes } from './use-hq-pinned-notes'
import { useHqNextWaitingShortcut } from './use-hq-next-waiting-shortcut'

const AGE_TICK_MS = 30_000
const NO_KEPT: string[] = []

export function HqMessengerScreen(): React.JSX.Element {
  const { items, cards } = useHqChatList()
  const colorFor = useHqProjectColor()
  const notes = useHqPinnedNotes(cards)
  const now = useNow(AGE_TICK_MS)
  const [selection, setSelection] = useState<HqSelection>(
    () => hqSelectionForRequest(takeRequestedHqTab()) ?? rememberedHqSelection()
  )
  const [chosen, setChosen] = useState<string | null>(null)
  // Why: on a narrow screen the list and the right side take turns; a pick shows the right side.
  const [narrowShowsDetail, setNarrowShowsDetail] = useState(selection.kind === 'pinned')
  // Why: the chat last shown stays put while statuses reshuffle the list under it.
  const selectedKey = pickHqChat(items, [chosen, rememberedHqChat()])
  const selectedChat =
    selection.kind === 'chat' ? items.find((item) => item.key === selectedKey) : undefined
  const keptProjectIds = useAppStore((state) => state.settings?.hqKeptProjectIds) ?? NO_KEPT
  const split = useMemo(
    () => splitHqActiveProjects(items, keptProjectIds, now),
    [items, keptProjectIds, now]
  )
  const groups = useMemo(() => groupHqChats(items), [items])
  // Why: the active projects' latest chats show in their own section, not again under Quiet.
  const listGroups = useMemo(() => ({ ...groups, quiet: split.quiet }), [groups, split.quiet])

  useEffect(
    () =>
      onHqTabRequested((requested) => {
        const found = hqSelectionForRequest(requested)
        if (found) {
          takeRequestedHqTab()
          setSelection(found)
          // Why: a chat asked for by name was remembered first; the last click must not outrank it.
          if (found.kind === 'chat') {
            setChosen(null)
          }
          setNarrowShowsDetail(true)
        }
      }),
    []
  )
  useEffect(() => rememberHqSelection(selection), [selection])

  const itemsRef = useRef(items)
  useEffect(() => {
    itemsRef.current = items
  }, [items])
  const shownChatKey = selectedChat?.key ?? null
  useEffect(() => {
    setShownHqChat(selectedChat ?? null)
  }, [selectedChat])
  useEffect(() => () => setShownHqChat(null), [])
  useEffect(() => {
    if (shownChatKey) {
      rememberHqChat(shownChatKey)
      // Why: the paired web client has no bell; on the desktop its finish toast is answered now.
      const shown = itemsRef.current.find((item) => item.key === shownChatKey)
      if (shown && !isWebClientLocation()) {
        void closeFinishedPulseBellItemsForHqChat(shown.worktreeId, hqChatTabId(shown)).catch(
          (error: unknown) => console.warn('[hq] closing the finish toast failed:', error)
        )
      }
    }
    // Why: a finish counts as read once the user moves on from it, so the row stays put while read.
    return () => acknowledgeHqChat(itemsRef.current.find((item) => item.key === shownChatKey))
  }, [shownChatKey])

  const selectChat = useCallback((key: string) => {
    setChosen(key)
    setSelection({ kind: 'chat' })
    setNarrowShowsDetail(true)
  }, [])
  // Why: a second press on the open pinned item closes it, back to what was shown before (owner, 18.10).
  const beforePinned = useRef<HqSelection>({ kind: 'chat' })
  const selectPinned = useCallback(
    (id: HqPinnedId) => {
      if (selection.kind === 'pinned' && selection.id === id) {
        const previous = beforePinned.current
        beforePinned.current = { kind: 'chat' }
        setSelection(previous.kind === 'pinned' && previous.id === id ? { kind: 'chat' } : previous)
        return
      }
      beforePinned.current = selection
      setSelection({ kind: 'pinned', id })
      setNarrowShowsDetail(true)
    },
    [selection]
  )
  const back = useCallback(() => setNarrowShowsDetail(false), [])
  const nextWaiting = useCallback(() => {
    const next = nextHqWaitingChat(groups.needs, selection.kind === 'chat' ? selectedKey : null)
    if (next) {
      selectChat(next)
    }
  }, [groups.needs, selectChat, selectedKey, selection.kind])
  const nextWaitingKeys = useHqNextWaitingShortcut(nextWaiting)
  const detailShown = narrowShowsDetail && (selection.kind === 'pinned' || selectedChat)

  return (
    <div className="@container/hq flex h-full min-h-0 w-full flex-col">
      {isWebClientLocation() ? <WebPushPrompt /> : null}
      <div className="flex min-h-0 flex-1">
        {/* Why: the narrow-screen hide sits on wrappers with no display class of their own, so no
            plain `flex` outranks it. */}
        <div
          className={cn(
            'min-h-0 w-80 shrink-0 border-r border-border @max-3xl/hq:w-full @max-3xl/hq:border-r-0',
            detailShown && '@max-3xl/hq:hidden'
          )}
        >
          <div className="flex h-full min-h-0 flex-col">
            <header className="flex shrink-0 items-center gap-2 px-4 pt-3 pb-2">
              <h1 className="text-sm font-semibold">{translate('auto.hq.title', 'HQ')}</h1>
              <div className="ml-auto">
                <HqViewSwitch />
              </div>
            </header>
            <div className="shrink-0 px-2 pb-2">
              <HqPinnedList
                selected={selection.kind === 'pinned' ? selection.id : null}
                notes={notes}
                onSelect={selectPinned}
              />
            </div>
            <div className="mx-4 shrink-0 border-t border-border" />
            <HqChatList
              groups={listGroups}
              activeProjects={split.active}
              onKeepProject={setHqProjectKept}
              colorFor={colorFor}
              selectedKey={selection.kind === 'chat' ? selectedKey : null}
              now={now}
              onSelect={selectChat}
              onMarkDoneRead={() => acknowledgeHqChats(groups.done)}
              onNextWaiting={nextWaiting}
              nextWaitingKeys={nextWaitingKeys}
            />
          </div>
        </div>
        <div className={cn('min-h-0 min-w-0 flex-1', !detailShown && '@max-3xl/hq:hidden')}>
          <div className="flex h-full min-h-0 flex-col">
            {selection.kind === 'pinned' ? (
              <HqPinnedPane id={selection.id} onBack={back} />
            ) : selectedChat ? (
              <div className="flex min-h-0 flex-1">
                <HqChatPane
                  item={selectedChat}
                  color={colorFor(selectedChat.repoId)}
                  onOpenProject={openHqChatInProject}
                  onBack={back}
                />
                {/* Why: beside the chat only where both fit; the hide sits on a display-less wrapper. */}
                <div className="min-h-0 @max-6xl/hq:hidden">
                  <HqContextPanel
                    item={selectedChat}
                    siblings={items.filter(
                      (other) =>
                        other.repoId === selectedChat.repoId && other.key !== selectedChat.key
                    )}
                    colorFor={colorFor}
                    onSelect={selectChat}
                  />
                </div>
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
                <MessagesSquare className="size-7" />
                <p className="text-xs">
                  {translate(
                    'auto.hq.chats.pick',
                    'Pick a chat on the left to read and answer it.'
                  )}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
