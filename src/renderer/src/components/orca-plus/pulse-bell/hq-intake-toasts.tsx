// Custom build (hq-slack-intake): a 👾-marked Slack message pops bottom-right as «To work» — who said
// it and where, what it is in a line, the suggested project — and the owner sends it to a chat of
// any project with a note, keeps it in Notes for later, or skips it.
import { useState } from 'react'
import { ExternalLink, Inbox } from 'lucide-react'
import { toast } from 'sonner'
import {
  HQ_INTAKE_KIND,
  hqIntakePrompt,
  hqIntakeVenueLabel,
  readHqIntake,
  type HqIntake
} from '../../../../../shared/hq-slack-intake'
import type { PulseInboxItem } from '../../../../../shared/pulse-types'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { formatShortTimeAgo } from '@/lib/short-time-ago'
import { useAppStore } from '@/store'
import { HqRouteForm } from './HqRouteForm'
import { sendHqRoutePrompt, type HqRouteTarget } from './hq-route-send'
import { HQ_ROUTE_NEW_CHAT, hqProjectChats, hqProjectNewChatWorktree } from './hq-route-targets'
import { showMeasuredCustomToast } from '../measured-custom-toast'

// Why: a burst (marks made on the phone while the Mac slept) must not wall the screen.
const MAX_SHOWN = 3

const toastId = (itemId: string): string => `intake-toast-${itemId}`

type Memory = { seen: Set<string>; shown: Set<string> }
const memory: Memory = { seen: new Set(), shown: new Set() }

/** The chosen chat as something to send to; null when the project has no workspace for a new one. */
export function hqRouteTargetFor(
  repoId: string | null,
  chat: string,
  newChatName: string
): HqRouteTarget | null {
  const state = useAppStore.getState()
  if (chat === HQ_ROUTE_NEW_CHAT) {
    const worktreeId = hqProjectNewChatWorktree(state, repoId)
    return worktreeId ? { kind: 'new', worktreeId, name: newChatName } : null
  }
  const sessionId = chat.replace(/^chat:/, '')
  const entry = hqProjectChats(state, repoId).find((candidate) => candidate.sessionId === sessionId)
  return entry ? { kind: 'chat', chat: entry } : null
}

function repoName(repoId: string | null): string | null {
  return useAppStore.getState().repos.find((repo) => repo.id === repoId)?.displayName ?? null
}

function HqIntakeCard({
  item,
  intake
}: {
  item: PulseInboxItem
  intake: HqIntake
}): React.JSX.Element {
  const [portal, setPortal] = useState<HTMLDivElement | null>(null)
  const [repoId, setRepoId] = useState(intake.repoId)
  const [chat, setChat] = useState<string>(HQ_ROUTE_NEW_CHAT)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  // Why a state: the card is drawn once when it pops, so its age is read then.
  const [shownAt] = useState(() => Date.now())
  const close = (): void => {
    toast.dismiss(toastId(item.id))
    memory.shown.delete(item.id)
  }
  const run = (work: () => Promise<boolean>): void => {
    setBusy(true)
    void work()
      .then((done) => {
        if (done) {
          close()
        }
      })
      .catch((error: unknown) => console.warn('[intake] action failed:', error))
      .finally(() => setBusy(false))
  }
  const send = async (): Promise<boolean> => {
    const target = hqRouteTargetFor(repoId, chat, intake.summary.slice(0, 60) || intake.author)
    if (!target) {
      toast.error(translate('auto.hqIntake.noTarget', 'Pick a project and a chat first'))
      return false
    }
    const sent = await sendHqRoutePrompt(
      target,
      hqIntakePrompt(intake, { projectName: repoName(repoId), note })
    )
    if (sent) {
      await window.api.pulseBell.closeIntake(
        item.id,
        'sent',
        `Sent to ${target.kind === 'chat' ? `«${target.chat.title}»` : `a new chat «${target.name}»`}`
      )
    }
    return sent
  }
  const later = async (): Promise<boolean> => {
    const kept = await window.api.pulseBell.keepIntakeInNotes(
      item.id,
      repoId === intake.repoId ? intake.project : repoName(repoId),
      note
    )
    if (!kept.ok) {
      toast.error(kept.error)
      return false
    }
    toast.success(translate('auto.hqIntake.kept', 'Kept in Notes — take it into work from there'))
    return true
  }
  const skip = async (): Promise<boolean> => {
    await window.api.pulseBell.closeIntake(item.id, 'skipped', 'Skipped')
    return true
  }
  return (
    <div
      ref={setPortal}
      role="alertdialog"
      aria-label={translate('auto.hqIntake.title', 'To work: {{name}}', { name: intake.author })}
      className="flex w-[var(--width)] max-w-[calc(100vw-32px)] flex-col gap-2 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-xs"
    >
      <div className="flex items-start gap-2">
        <Inbox className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">
            {translate('auto.hqIntake.title', 'To work: {{name}}', { name: intake.author })}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {[hqIntakeVenueLabel(intake), intake.at ? formatShortTimeAgo(intake.at, shownAt) : null]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        {intake.permalink ? (
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            title={translate('auto.hqIntake.openSlack', 'Open in Slack')}
            aria-label={translate('auto.hqIntake.openSlack', 'Open in Slack')}
            onClick={() => void window.api.shell.openUrl(intake.permalink ?? '')}
          >
            <ExternalLink />
          </Button>
        ) : null}
      </div>
      {intake.summary ? <p className="text-xs font-medium">{intake.summary}</p> : null}
      <p className="line-clamp-4 text-xs whitespace-pre-line text-muted-foreground">
        {intake.text}
      </p>
      {intake.links.length + intake.files.length > 0 ? (
        <p className="truncate text-[11px] text-muted-foreground">
          {[...intake.links, ...intake.files].join(' · ')}
        </p>
      ) : null}
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
        disabled={busy}
        portal={portal}
      />
      <div className="flex flex-wrap justify-end gap-1">
        <Button type="button" size="xs" variant="ghost" disabled={busy} onClick={() => run(skip)}>
          {translate('auto.hqIntake.skip', 'Skip')}
        </Button>
        <Button type="button" size="xs" variant="ghost" disabled={busy} onClick={() => run(later)}>
          {translate('auto.hqIntake.later', 'Later → Notes')}
        </Button>
        <Button type="button" size="xs" disabled={busy || !repoId} onClick={() => run(send)}>
          {translate('auto.hqIntake.send', 'Send to chat')}
        </Button>
      </div>
    </div>
  )
}

/** Pops the card for this bell item, also when it was put off before (bell, Notes). */
export function showHqIntakeCard(item: PulseInboxItem): boolean {
  const intake = item.kind === HQ_INTAKE_KIND ? readHqIntake(item.refId) : null
  if (!intake) {
    return false
  }
  memory.seen.add(item.id)
  memory.shown.add(item.id)
  showMeasuredCustomToast(() => <HqIntakeCard item={item} intake={intake} />, {
    id: toastId(item.id),
    duration: Number.POSITIVE_INFINITY,
    unstyled: true,
    dismissible: false,
    closeButton: false
  })
  return true
}

/** Pops each new mark once and closes the cards of the ones handled (here, on the phone, or unmarked). */
export function syncHqIntakeToasts(items: readonly PulseInboxItem[]): void {
  const open = new Map(
    items.filter((item) => item.kind === HQ_INTAKE_KIND).map((item) => [item.id, item])
  )
  for (const id of memory.shown) {
    if (!open.has(id)) {
      toast.dismiss(toastId(id))
      memory.shown.delete(id)
    }
  }
  for (const item of open.values()) {
    // Why: one put off with Later was read; it waits in Notes and the bell, not on screen.
    if (memory.seen.has(item.id) || item.readAt !== null || memory.shown.size >= MAX_SHOWN) {
      continue
    }
    showHqIntakeCard(item)
  }
}
