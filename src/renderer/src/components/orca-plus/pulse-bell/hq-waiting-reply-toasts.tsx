// Custom build (hq-reply-approve): «Анна replied» pops bottom-right with her words; the chat that asked
// is picked, and the owner sends the answer there — or to any chat of any project — with a note,
// skips it, or leaves it in the bell for later. One card per answer: a DM message can answer several
// chats waiting on her, and each stays on the card until it is sent or skipped.
import { useState } from 'react'
import { ExternalLink, MessageSquareReply } from 'lucide-react'
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
import { hqWaitingReplyPrompt } from '../../../../../shared/hq-waiting-replies'
import { showMeasuredCustomToast } from '../measured-custom-toast'
import { HqRouteForm } from './HqRouteForm'
import { hqRouteTargetFor } from './hq-intake-toasts'
import { sendHqRoutePrompt, type HqRouteTarget } from './hq-route-send'
import {
  HQ_ROUTE_NEW_CHAT,
  hqRepoOfWorktree,
  hqRouteChatValue,
  type HqRouteChat
} from './hq-route-targets'

// Why: a burst (answers that came while Orca+ was closed) must not wall the screen.
const MAX_SHOWN = 3

type Target = { itemId: string; ref: HqWaitingReplyRef }

export type HqWaitingReplyToastMemory = {
  /** Shown cards by answer, with the item ids each one was last drawn with. */
  shown: Map<string, string>
  seen: Set<string>
  /** Put off with Later: it stays in the bell and does not pop again. */
  later: Set<string>
  /** The last inbox seen, so a card put off with Later lets a queued one pop. */
  items: readonly PulseInboxItem[]
}

export function createHqWaitingReplyToastMemory(): HqWaitingReplyToastMemory {
  return { shown: new Map(), seen: new Set(), later: new Set(), items: [] }
}

const toastId = (answer: string): string => `waiting-reply-toast-${answer}`

function chatTitle(ref: HqWaitingReplyRef): string {
  const state = useAppStore.getState()
  const tabId = ref.sessionId ? structuredAgentSessionTabId(ref.sessionId) : null
  const tab = ref.worktreeId
    ? state.unifiedTabsByWorktree[ref.worktreeId]?.find((entry) => entry.id === tabId)
    : undefined
  const title = tab
    ? resolveAgentSessionTabTitle(tab, null, state.settings?.tabAutoGenerateTitle === true)
    : null
  return `${title ?? 'Chat'} — «${ref.question}»`
}

/** The chats that asked, offered first whatever project is picked. */
function askingChats(targets: readonly Target[]): HqRouteChat[] {
  return targets.flatMap((target) =>
    target.ref.sessionId && target.ref.worktreeId
      ? [
          {
            sessionId: target.ref.sessionId,
            worktreeId: target.ref.worktreeId,
            title: chatTitle(target.ref),
            lastAt: target.ref.askedAt
          }
        ]
      : []
  )
}

// Custom build (hq-reply-source-link): where it was said, to read it in its context.
function OpenSourceButton({ link }: { link: string }): React.JSX.Element {
  const label = link.includes('clickup.com')
    ? translate('auto.hqWaitingReply.openClickUp', 'Open in ClickUp')
    : translate('auto.hqWaitingReply.openSlack', 'Open in Slack')
  return (
    <Button
      type="button"
      size="icon-xs"
      variant="ghost"
      title={label}
      aria-label={label}
      onClick={() => void window.api.shell.openUrl(link)}
    >
      <ExternalLink />
    </Button>
  )
}

function HqWaitingReplyToast({
  answer,
  targets,
  onLater
}: {
  answer: string
  targets: Target[]
  onLater: () => void
}): React.JSX.Element | null {
  const first = targets[0]?.ref
  const asking = askingChats(targets)
  const [portal, setPortal] = useState<HTMLDivElement | null>(null)
  const [repoId, setRepoId] = useState<string | null>(() =>
    first ? hqRepoOfWorktree(useAppStore.getState(), first.worktreeId) : null
  )
  const [chat, setChat] = useState<string>(() =>
    asking[0] ? hqRouteChatValue(asking[0].sessionId) : HQ_ROUTE_NEW_CHAT
  )
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  if (!first) {
    return null
  }
  const run = (work: () => Promise<unknown>): void => {
    setBusy(true)
    void work()
      .catch((error: unknown) => console.warn('[waiting-reply] toast action failed:', error))
      .finally(() => setBusy(false))
  }
  const send = async (): Promise<void> => {
    const sessionId = chat.replace(/^chat:/, '')
    const asked = targets.find((target) => target.ref.sessionId === sessionId)
    const pinned = asking.find((entry) => entry.sessionId === sessionId)
    const target: HqRouteTarget | null = pinned
      ? { kind: 'chat', chat: pinned }
      : hqRouteTargetFor(repoId, chat, `${first.author}: ${first.question}`.slice(0, 60))
    if (!target) {
      toast.error(translate('auto.hqIntake.noTarget', 'Pick a project and a chat first'))
      return
    }
    const ref = (asked ?? targets[0]).ref
    const sent = await sendHqRoutePrompt(
      target,
      hqWaitingReplyPrompt(
        {
          id: ref.waitingId,
          title: ref.question,
          reply: ref.reply,
          replyAuthor: ref.author,
          project: ref.project
        },
        { note, askedElsewhere: !asked }
      )
    )
    if (sent) {
      // Why: the answer reached a chat; the card keeps the other questions it may also answer.
      await window.api.pulseBell.skipWaitingReply(ref.waitingId, ref.replyTs)
      setNote('')
    }
  }
  const skipAll = (): Promise<unknown> =>
    Promise.all(
      targets.map((target) =>
        window.api.pulseBell.skipWaitingReply(target.ref.waitingId, target.ref.replyTs)
      )
    )
  return (
    <div
      ref={setPortal}
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
          <p className="truncate text-xs text-muted-foreground">
            {[first.project, `«${first.question}»`].filter(Boolean).join(' · ')}
          </p>
        </div>
        {first.link ? <OpenSourceButton link={first.link} /> : null}
      </div>
      <p className="line-clamp-5 text-xs whitespace-pre-line text-muted-foreground">
        {first.reply}
      </p>
      <HqRouteForm
        repoId={repoId}
        onRepoChange={(next) => {
          setRepoId(next)
          setChat(HQ_ROUTE_NEW_CHAT)
        }}
        chat={chat}
        onChatChange={setChat}
        note={note}
        onNoteChange={setNote}
        pinned={{
          label: translate('auto.hqWaitingReply.asking', 'Waiting for this answer'),
          chats: asking
        }}
        disabled={busy}
        portal={portal}
      />
      <div className="flex flex-wrap justify-end gap-1">
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
          onClick={() => {
            onLater()
            toast.dismiss(toastId(answer))
          }}
        >
          {translate('auto.hqWaitingReply.later', 'Later')}
        </Button>
        <Button type="button" size="xs" disabled={busy} onClick={() => run(send)}>
          {translate('auto.hqWaitingReply.send', 'Send to chat')}
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
  memory.items = items
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
    const onLater = (): void => {
      memory.later.add(answer)
      memory.shown.delete(answer)
      syncHqWaitingReplyToasts(memory.items, memory)
    }
    showMeasuredCustomToast(
      () => <HqWaitingReplyToast answer={answer} targets={targets} onLater={onLater} />,
      {
        id: toastId(answer),
        duration: Number.POSITIVE_INFINITY,
        unstyled: true,
        dismissible: false,
        closeButton: false,
        onDismiss: () => {
          memory.shown.delete(answer)
        }
      }
    )
  }
}
