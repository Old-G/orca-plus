// Custom build (hq-plus-ui-v4): HQ+'s feed keys (Settings → Shortcuts → HQ+). They act on the selected
// card and only while HQ+ is on view, no dialog is open and nothing is being typed.
import { useEffect, useRef } from 'react'
import { useAppStore } from '@/store'
import { addAppKeyListener, removeAppKeyListener } from '@/lib/app-keyboard-router'
import { getShortcutPlatform } from '@/lib/shortcut-platform'
import { hasVisibleOverlay } from '@/lib/visible-overlay'
import {
  keybindingMatchesAction,
  type HqPlusKeybindingActionId
} from '../../../../../shared/keybindings'
import type { HqPlusFeedFilter } from '../../../../../shared/hq-plus-feed-filter'
import type { HqPlusLogItem } from '../../../../../shared/hq-plus-log'

export type HqPlusFeedKeyActions = {
  /** The rows on view, in feed order. */
  items: readonly HqPlusLogItem[]
  /** Your-move rows on view; J/K walk these first when the chips show everything. */
  moveIds: readonly string[]
  filter: HqPlusFeedFilter
  selectedId: string | null
  select: (id: string) => void
  isExpanded: (id: string) => boolean
  setExpanded: (id: string, open: boolean) => void
  open: (item: HqPlusLogItem) => void
  done: (item: HqPlusLogItem) => void
  setFilter: (filter: HqPlusFeedFilter) => void
  openSearch: () => void
  /** Folds what is open first; false when there was nothing for Esc to do here. */
  escape: () => boolean
}

const FILTER_KEYS: readonly [HqPlusKeybindingActionId, HqPlusFeedFilter][] = [
  ['hqPlus.filterAll', 'all'],
  ['hqPlus.filterMove', 'move'],
  ['hqPlus.filterChats', 'chats'],
  ['hqPlus.filterInbox', 'inbox']
]

function typingIn(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.closest('input, textarea, select, [contenteditable]') !== null)
  )
}

function onHqPlus(target: EventTarget | null): boolean {
  const screen = document.querySelector('.hq-plus')
  if (!screen?.checkVisibility()) {
    return false
  }
  // Custom build (hq-plus-panel-keys): the right panel holds a chat, a file or a page of its own; keys
  // pressed there are its, never the feed's. So are a file's opened in the center.
  if (target instanceof Element && target.closest('.hqp-pv, .hqp-center-file') !== null) {
    return false
  }
  return target === document.body || (target instanceof Node && screen.contains(target))
}

/** The selected row, scrolled to the middle of the feed. */
function showRow(id: string): void {
  const row = document.getElementById(`hqp-${id}`)
  const log = row?.closest('.hqp-log')
  if (row && log) {
    const offset = row.getBoundingClientRect().top - log.getBoundingClientRect().top
    log.scrollTo({
      top: log.scrollTop + offset - log.clientHeight / 2 + row.clientHeight / 2,
      behavior: 'smooth'
    })
  }
}

export function useHqPlusFeedKeys(actions: HqPlusFeedKeyActions): void {
  const keybindings = useAppStore((state) => state.keybindings)
  const activeModal = useAppStore((state) => state.activeModal)
  const latest = useRef(actions)
  latest.current = actions

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.isComposing || activeModal !== 'none') {
        return
      }
      if (typingIn(event.target) || !onHqPlus(event.target) || hasVisibleOverlay()) {
        return
      }
      const platform = getShortcutPlatform()
      const is = (id: HqPlusKeybindingActionId): boolean =>
        keybindingMatchesAction(id, event, platform, keybindings)
      const now = latest.current
      const selected = now.items.find((item) => item.id === now.selectedId) ?? null
      const handled = (): void => {
        event.preventDefault()
        event.stopPropagation()
      }
      const step = (direction: 1 | -1): void => {
        const ids =
          now.filter === 'all' && now.moveIds.length > 0
            ? now.moveIds
            : now.items.filter((item) => item.kind !== 'me').map((item) => item.id)
        if (ids.length === 0) {
          return
        }
        const at = selected ? ids.indexOf(selected.id) : -1
        const next = ids.at(at === -1 ? (direction === 1 ? 0 : -1) : (at + direction) % ids.length)
        if (!next) {
          return
        }
        now.select(next)
        showRow(next)
      }
      if (is('hqPlus.next')) {
        handled()
        step(1)
        return
      }
      if (is('hqPlus.previous')) {
        handled()
        step(-1)
        return
      }
      if (is('hqPlus.search')) {
        handled()
        now.openSearch()
        return
      }
      for (const [id, filter] of FILTER_KEYS) {
        if (is(id)) {
          handled()
          now.setFilter(filter)
          return
        }
      }
      if (is('hqPlus.escape')) {
        if (now.escape()) {
          handled()
        }
        return
      }
      // Why: Enter on a focused button or link presses it; the card keys need a selected card.
      const onControl =
        event.target instanceof Element && event.target.closest('button, a, [role="button"]')
      if (!selected || (onControl && is('hqPlus.toggle'))) {
        return
      }
      const row = document.getElementById(`hqp-${selected.id}`)
      if (is('hqPlus.toggle')) {
        handled()
        now.setExpanded(selected.id, !now.isExpanded(selected.id))
      } else if (is('hqPlus.open')) {
        handled()
        now.open(selected)
      } else if (is('hqPlus.reply')) {
        handled()
        now.setExpanded(selected.id, true)
        // Why: the reply box mounts with the unfolded card; focus it on the next frame.
        requestAnimationFrame(() =>
          document.getElementById(`hqp-${selected.id}`)?.querySelector('textarea')?.focus()
        )
      } else if (is('hqPlus.done')) {
        handled()
        now.done(selected)
      } else if (is('hqPlus.close')) {
        // Why: the card's own × asks first when the chat is working, so the key goes through it.
        const close = row?.querySelector<HTMLButtonElement>('.hqp-x')
        if (close) {
          handled()
          close.click()
        }
      }
    }
    addAppKeyListener('keydown', onKey)
    return () => removeAppKeyListener('keydown', onKey)
  }, [keybindings, activeModal])
}
