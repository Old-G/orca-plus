// Custom build (hq-reply-approve): «Анна replied» pops bottom-right with her words and the chat (or
// chats) waiting for them; the owner passes the answer on, opens the chat, skips it, or leaves it in
// the bell for later. One card per answer: a DM message can answer several chats waiting on her.
import { useState } from 'react'
import { MessageSquareReply } from 'lucide-react'
import { toast } from 'sonner'
import {
  HQ_WAITING_REPLY_KIND,
  readHqWaitingReplyRef,
  type HqWaitingReplyRef
} from '../../../../../shared/hq-waiting-reply-bell'
import { structuredAgentSessionTabId } from '../../../../../shared/structured-agent-session-projection'
import type { PulseInboxItem } from '../../../../../shared/pulse-types'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { resolveAgentSessionTabTitle } from '../../tab-bar/tab-bar-item-model'
import { openHqWaitingReplyChat, passHqWaitingReply } from './hq-waiting-reply-actions'

// Why: a burst (answers that came while Orca+ was closed) must not wall the screen.
const MAX_SHOWN = 3

type Target = { itemId: string; ref: HqWaitingReplyRef }

export type HqWaitingReplyToastMemory = {
  /** Shown cards by answer, with the item ids each one was last drawn with. */
  shown: Map<string, string>
  seen: Set<string>
  /** Put off with Later: it stays in the bell and does not pop again. */
  later: Set<string>
}

export function createHqWaitingReplyToastMemory(): HqWaitingReplyToastMemory {
  return { shown: new Map(), seen: new Set(), later: new Set() }
}

const toastId = (answer: string): string => `waiting-reply-toast-${answer}`

function useChatTitle(ref: HqWaitingReplyRef): string | null {
  return useAppStore((state) => {
    if (!ref.worktreeId || !ref.sessionId) {
      return null
    }
    const tabId = structuredAgentSessionTabId(ref.sessionId)
    const tab = state.unifiedTabsByWorktree[ref.worktreeId]?.find((entry) => entry.id === tabId)
    return tab
      ? resolveAgentSessionTabTitle(tab, null, state.settings?.tabAutoGenerateTitle === true)
      : null
  })
}

function TargetRow({
  target,
  busy,
  onPass
}: {
  target: Target
  busy: boolean
  onPass: () => void
}): React.JSX.Element {
  const title = useChatTitle(target.ref)
  return (
    <div className="flex items-center gap-2 rounded-md bg-muted px-2 py-1.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium">{title ?? `«${target.ref.question}»`}</p>
        <p className="truncate text-[11px] text-muted-foreground">
          {[target.ref.project, title ? `«${target.ref.question}»` : null]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </div>
      {target.ref.sessionId ? (
        <Button type="button" size="xs" variant="secondary" disabled={busy} onClick={onPass}>
          {translate('auto.hqWaitingReply.pass', 'Pass to chat')}
        </Button>
      ) : null}
    </div>
  )
}

function HqWaitingReplyToast({
  answer,
  targets
}: {
  answer: string
  targets: Target[]
}): React.JSX.Element | null {
  const [busy, setBusy] = useState(false)
  const first = targets[0]?.ref
  const run = (work: () => Promise<unknown>): void => {
    setBusy(true)
    void work()
      .catch((error: unknown) => console.warn('[waiting-reply] toast action failed:', error))
      .finally(() => setBusy(false))
  }
  const skipAll = (): Promise<unknown> =>
    Promise.all(
      targets.map((target) => window.api.pulseBell.skipWaitingReply(target.ref.waitingId))
    )
  if (!first) {
    return null
  }
  const single = targets.length === 1 && first.sessionId !== null
  return (
    <div
      role="alertdialog"
      aria-label={translate('auto.hqWaitingReply.title', '{{name}} replied', {
        name: first.author
      })}
      className="flex w-[var(--width)] max-w-[calc(100vw-32px)] flex-col gap-2 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-xs"
    >
      <div className="flex items-start gap-2">
        <MessageSquareReply
          className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">
            {translate('auto.hqWaitingReply.title', '{{name}} replied', { name: first.author })}
          </p>
          <p className="line-clamp-4 text-xs whitespace-pre-line text-muted-foreground">
            {first.reply}
          </p>
        </div>
      </div>
      <div className="flex flex-col gap-1">
        {targets.map((target) => (
          <TargetRow
            key={target.itemId}
            target={target}
            busy={busy}
            onPass={() => run(() => passHqWaitingReply(target.ref))}
          />
        ))}
      </div>
      <div className="flex flex-wrap justify-end gap-1">
        {single ? (
          <Button
            type="button"
            size="xs"
            variant="ghost"
            disabled={busy}
            onClick={() => run(() => openHqWaitingReplyChat(first))}
          >
            {translate('auto.hqWaitingReply.open', 'Open chat')}
          </Button>
        ) : null}
        <Button
          type="button"
          size="xs"
          variant="ghost"
          disabled={busy}
          onClick={() => run(skipAll)}
        >
          {targets.length > 1
            ? translate('auto.hqWaitingReply.skipAll', 'Skip all')
            : translate('auto.hqWaitingReply.skip', 'Skip')}
        </Button>
        <Button
          type="button"
          size="xs"
          variant="ghost"
          disabled={busy}
          onClick={() => toast.dismiss(toastId(answer))}
        >
          {translate('auto.pulseBell.action.later', 'Later')}
        </Button>
      </div>
    </div>
  )
}

/** One answer can wait in several chats; they share a card. Each chat still gets the words said
 *  since its own question. */
export function groupHqWaitingReplies(items: readonly PulseInboxItem[]): Map<string, Target[]> {
  const groups = new Map<string, Target[]>()
  for (const item of items) {
    const ref = item.kind === HQ_WAITING_REPLY_KIND ? readHqWaitingReplyRef(item.refId) : null
    if (!ref) {
      continue
    }
    const answer = `${ref.author}:${ref.replyTs}`
    groups.set(answer, [...(groups.get(answer) ?? []), { itemId: item.id, ref }])
  }
  // Why newest question first: its words since that question are the card's quote.
  for (const targets of groups.values()) {
    targets.sort((a, b) => b.ref.askedAt - a.ref.askedAt)
  }
  return groups
}

/** Pops each new answer, redraws a card whose chats changed, and closes the ones handled. */
export function syncHqWaitingReplyToasts(
  items: readonly PulseInboxItem[],
  memory: HqWaitingReplyToastMemory
): void {
  const groups = groupHqWaitingReplies(items)
  for (const answer of memory.shown.keys()) {
    if (!groups.has(answer)) {
      toast.dismiss(toastId(answer))
      memory.shown.delete(answer)
    }
  }
  for (const [answer, targets] of groups) {
    const drawn = targets.map((target) => target.itemId).join(',')
    const shown = memory.shown.get(answer)
    if (
      shown === drawn ||
      memory.later.has(answer) ||
      (shown === undefined && memory.seen.has(answer))
    ) {
      continue
    }
    if (shown === undefined && memory.shown.size >= MAX_SHOWN) {
      continue
    }
    memory.seen.add(answer)
    memory.shown.set(answer, drawn)
    toast.custom(() => <HqWaitingReplyToast answer={answer} targets={targets} />, {
      id: toastId(answer),
      duration: Number.POSITIVE_INFINITY,
      unstyled: true,
      dismissible: false,
      closeButton: false,
      onDismiss: () => {
        if (groupHqWaitingReplies(items).has(answer)) {
          memory.later.add(answer)
        }
        memory.shown.delete(answer)
      }
    })
  }
}
