// Custom build (hq-router T4, owner 26.11): «👾 Router» — the pinned row on top of the chat tree and its
// screen on the right. Every message (a 👾 mark, a pasted Slack link, pasted text) is one card: where the
// router would send it, why, and how sure. «Send» hands it to that chat; another chat is one click (its
// two runner-ups) or the full picker. One model call per message in main, nothing remembered between
// them; in the trial nothing leaves without «Send».
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  hqIntakeIsPastedText,
  hqIntakePrompt,
  hqIntakeVenueLabel,
  type HqIntake
} from '../../../../../shared/hq-slack-intake'
import { hqRouterPasteParts } from '../../../../../shared/hq-router-paste'
import type { PulseInboxItem } from '../../../../../shared/pulse-types'
import type { HqPlusBadge } from '../../../../../shared/hq-plus-kinds'
import { translate } from '@/i18n/i18n'
import { formatShortTimeAgo } from '@/lib/time-format/short-time-ago'
import { useAppStore } from '@/store'
import { sendHqRoutePrompt } from '../pulse-bell/hq-route-send'
import {
  hqPlusRouterCards,
  hqPlusRouterSendsTo,
  hqPlusRouterChatWorktree,
  type HqPlusRouterCard
} from './hq-plus-router'
import { noteHqPlusTakeHint } from './hq-plus-take-hint'
import { HqPlusBadges } from './HqPlusBadge'
import './hq-plus-router.css'

/** The router's open cards, kept fresh with the bell. */
export function useHqPlusRouterCards(): HqPlusRouterCard[] {
  const [cards, setCards] = useState<HqPlusRouterCard[]>([])
  useEffect(() => {
    let live = true
    const load = (): void => {
      void window.api.pulseBell
        .list()
        .then((items) => {
          if (live) {
            setCards(hqPlusRouterCards(items))
          }
        })
        .catch(() => undefined)
    }
    load()
    const unsubscribe = window.api.pulseBell.onChanged(load)
    return () => {
      live = false
      unsubscribe()
    }
  }, [])
  return cards
}

/** The pinned row: always first in the tree, with how many cards wait for «Send». */
export function HqPlusRouterRow({
  open,
  onOpen
}: {
  open: boolean
  onOpen: () => void
}): React.JSX.Element {
  const count = useHqPlusRouterCards().length
  return (
    <button
      type="button"
      className="hqr-row"
      aria-pressed={open}
      title={translate(
        'auto.hqPlus.router.rowTip',
        'Paste a Slack link or text, or mark a message with 👾 — each becomes a card: where it goes and why'
      )}
      onClick={onOpen}
    >
      <span className="hqr-row-t">👾 {translate('auto.hqPlus.router.title', 'Router')}</span>
      <span className="hqr-row-s">
        {count > 0
          ? translate('auto.hqPlus.router.waiting', '{{count}} to check', { count })
          : translate('auto.hqPlus.router.none', 'nothing to check')}
      </span>
      {count > 0 ? <span className="hqr-count">{count}</span> : null}
    </button>
  )
}

function sourceOf(card: HqPlusRouterCard): string {
  const { intake } = card
  if (hqIntakeIsPastedText(intake)) {
    return translate('auto.hqPlus.router.fromText', 'Text')
  }
  const via = intake.pasted ? translate('auto.hqPlus.router.fromLink', 'Link') : '👾 Slack'
  return `${via} · ${hqIntakeVenueLabel(intake)}`
}

function sureOf(intake: HqIntake): { label: string; tone: 'sure' | 'mid' | 'low' } | null {
  const route = intake.route
  if (!route) {
    return null
  }
  if (route.how !== 'model' && route.how !== 'fallback' && route.how !== 'none') {
    return { label: translate('auto.hqPlus.router.exact', 'exact'), tone: 'sure' }
  }
  if (route.confidence === null) {
    return route.how === 'none'
      ? { label: translate('auto.hqPlus.router.unsure', 'no pick'), tone: 'low' }
      : null
  }
  const share = route.confidence.toFixed(2)
  return {
    label: `${route.model ?? 'model'} · ${share}`,
    tone: route.confidence >= 0.8 ? 'sure' : route.confidence >= 0.5 ? 'mid' : 'low'
  }
}

async function promptFor(intake: HqIntake, projectName: string | null): Promise<string> {
  // Why (hq-intake-thread): the chat gets the thread whole, as «To work» sends it.
  const thread =
    intake.threadTs && !hqIntakeIsPastedText(intake)
      ? await window.api.pulseBell.intakeThread(intake.channel, intake.threadTs).catch(() => null)
      : null
  const whole = thread && thread.lines.length > 0 ? thread : null
  return hqIntakePrompt(
    whole
      ? {
          ...intake,
          text: whole.lines.join('\n'),
          wholeThread: true,
          links: [...new Set([...intake.links, ...whole.links])]
        }
      : intake,
    { projectName, note: '' }
  )
}

/** One Router card: «→ chat» and why before anything is sent; the feed shows the same card with its badges. */
export function HqPlusRouterCardView({
  card,
  now,
  onTake,
  badges
}: {
  card: HqPlusRouterCard
  now: number
  onTake: (item: PulseInboxItem) => void
  badges?: readonly HqPlusBadge[]
}): React.JSX.Element {
  const { item, intake } = card
  const route = intake.route ?? null
  const [busy, setBusy] = useState(false)
  const target = hqPlusRouterSendsTo(intake)
  const sure = sureOf(intake)
  const sendTo = async (
    sessionId: string,
    title: string,
    known: string | null | undefined
  ): Promise<void> => {
    // Why (owner 26.11): a done or closed chat is reopened to take it — by its tab, else its worktree.
    const worktreeId = hqPlusRouterChatWorktree(
      useAppStore.getState().unifiedTabsByWorktree,
      sessionId,
      known
    )
    const prompt = await promptFor(intake, route?.project ?? intake.project)
    const sent = await sendHqRoutePrompt(
      { kind: 'chat', chat: { sessionId, worktreeId, title } },
      prompt
    )
    if (sent) {
      // Why with the chat: the owner's choice binds the thread and goes into the router's log.
      await window.api.pulseBell.closeIntake(item.id, 'sent', `Sent to «${title}»`, sessionId)
    }
  }
  const run = (work: () => Promise<void>): void => {
    setBusy(true)
    void work()
      .catch((error: unknown) => toast.error(String(error)))
      .finally(() => setBusy(false))
  }
  const pick = (): void => {
    // Why: the full picker opens on the router's pick, so a near miss is one change away.
    noteHqPlusTakeHint(item.id, {
      project: route?.project ?? intake.project,
      sessionId: target
    })
    onTake(item)
  }
  const when = intake.at ? formatShortTimeAgo(intake.at, now) : null
  return (
    <article className="hqr-card" aria-busy={busy}>
      <div className="hqr-from">
        {badges ? <HqPlusBadges badges={badges} /> : null}
        <span>{sourceOf(card)}</span>
        <span>·</span>
        <span>{intake.author}</span>
        {when ? <span>· {when}</span> : null}
        {intake.permalink ? (
          <button
            type="button"
            className="hqr-link"
            onClick={() => void window.api.shell.openUrl(intake.permalink ?? '')}
          >
            {translate('auto.hqIntake.openSlack', 'Open in Slack')}
          </button>
        ) : null}
      </div>
      <p className="hqr-q">{intake.text}</p>
      <div className="hqr-to">
        <span className="hqr-arr" aria-hidden="true">
          →
        </span>
        <span className="hqr-tt">
          {route
            ? target
              ? (route.targetTitle ?? target)
              : translate('auto.hqPlus.router.newChat', 'a new chat')
            : translate('auto.hqPlus.router.noRoute', 'no pick — choose a chat')}
        </span>
        {route && route.level === 'lead' ? <span className="hqr-lvl">LEAD</span> : null}
        {route?.project ? <span className="hqr-proj">{route.project}</span> : null}
        {sure ? (
          <span className="hqr-sure" data-tone={sure.tone}>
            {sure.label}
          </span>
        ) : null}
      </div>
      {route?.why ? <p className="hqr-why">{route.why}</p> : null}
      <div className="hqr-acts">
        {target ? (
          <button
            type="button"
            className="hqp-opt"
            data-main="true"
            disabled={busy}
            onClick={() =>
              run(() => sendTo(target, route?.targetTitle ?? target, route?.worktreeId))
            }
          >
            {translate('auto.hqPlus.router.send', 'Send')}
          </button>
        ) : (
          <button type="button" className="hqp-opt" data-main="true" disabled={busy} onClick={pick}>
            {translate('auto.hqPlus.router.pick', 'Pick a chat')}
          </button>
        )}
        {(route?.alternatives ?? []).map((other) => (
          <button
            key={other.sessionId}
            type="button"
            className="hqp-opt"
            disabled={busy}
            title={translate('auto.hqRouter.other', 'Pick this chat instead')}
            onClick={() => run(() => sendTo(other.sessionId, other.title, other.worktreeId))}
          >
            {other.title.slice(0, 40)}
          </button>
        ))}
        {target ? (
          <button type="button" className="hqp-opt" disabled={busy} onClick={pick}>
            {translate('auto.hqPlus.router.other', 'Other chat…')}
          </button>
        ) : null}
        <span className="hqp-spacer" />
        <button
          type="button"
          className="hqp-opt"
          data-ghost="true"
          disabled={busy}
          onClick={() =>
            run(() => window.api.pulseBell.closeIntake(item.id, 'skipped', 'Skipped in the router'))
          }
        >
          {translate('auto.hqIntake.skip', 'Skip')}
        </button>
      </div>
    </article>
  )
}

/** What the owner pasted, routed: each Slack link one card, the text left around them one more. */
async function routePaste(input: string): Promise<number> {
  const parts = hqRouterPasteParts(input)
  const asks = [
    ...parts.links.map((link) => window.api.pulseBell.routeLink(link)),
    ...(parts.text ? [window.api.pulseBell.routeText(parts.text)] : [])
  ]
  const results = await Promise.all(
    asks.map((ask) => ask.catch((error: unknown) => ({ ok: false as const, error: String(error) })))
  )
  let made = 0
  for (const result of results) {
    if (!result.ok) {
      toast.error(result.error)
    } else if ('existing' in result && result.existing) {
      toast.info(
        translate('auto.hqPlus.router.existing', 'Already marked with 👾 — its card is here')
      )
    } else {
      made += 1
    }
  }
  return made
}

export function HqPlusRouter({
  now,
  onTake
}: {
  now: number
  /** The full picker («To work» on the right) for a card. */
  onTake: (item: PulseInboxItem) => void
}): React.JSX.Element {
  const cards = useHqPlusRouterCards()
  const [text, setText] = useState('')
  const [pending, setPending] = useState(0)
  const submit = (): void => {
    const value = text.trim()
    if (!value) {
      return
    }
    const parts = hqRouterPasteParts(value)
    const count = parts.links.length + (parts.text ? 1 : 0)
    if (count === 0) {
      return
    }
    setText('')
    setPending((n) => n + count)
    void routePaste(value).finally(() => setPending((n) => Math.max(0, n - count)))
  }
  return (
    <section className="hqr" aria-label={translate('auto.hqPlus.router.title', 'Router')}>
      <header className="hqr-h">
        <strong>👾 {translate('auto.hqPlus.router.title', 'Router')}</strong>
        <span className="hqr-h-s">
          {translate(
            'auto.hqPlus.router.summary',
            '{{count}} to check · nothing is sent before «Send»',
            {
              count: cards.length
            }
          )}
        </span>
      </header>
      <div className="hqr-list">
        {pending > 0 ? (
          <p className="hqr-pending">
            {translate('auto.hqPlus.router.routing', 'Routing {{count}}…', { count: pending })}
          </p>
        ) : null}
        {cards.length === 0 && pending === 0 ? (
          <p className="hqp-empty hqp-quiet">
            {translate(
              'auto.hqPlus.router.empty',
              'Nothing to check. Mark a Slack message with 👾, or paste its link or text below.'
            )}
          </p>
        ) : null}
        {cards.map((card) => (
          <HqPlusRouterCardView key={card.item.id} card={card} now={now} onTake={onTake} />
        ))}
      </div>
      <form
        className="hqr-compose"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <textarea
          value={text}
          rows={3}
          placeholder={translate(
            'auto.hqPlus.router.placeholder',
            'Paste Slack links (one card each) or a message’s text · ⏎ to route, ⇧⏎ new line'
          )}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              submit()
            }
          }}
        />
        <button type="submit" className="hqp-opt" data-main="true" disabled={!text.trim()}>
          {translate('auto.hqPlus.router.route', 'Route')}
        </button>
      </form>
    </section>
  )
}
