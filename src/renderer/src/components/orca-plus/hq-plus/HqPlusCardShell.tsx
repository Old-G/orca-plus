// Custom build (hq-plus-card-shell): the one shell HQ+'s feed cards are drawn in — a decision, a chat, a
// conversation, a report (owner, 31.10: one component per card, not five copies). The head (badges, who,
// the chat, the time, the source on the right), a folded line, the body, a row of buttons, the reply box
// (HqPlusComposer), «✓ done», an error and «Collapse»; a card kind gives only its own parts.
import { useState } from 'react'
import { translate } from '@/i18n/i18n'
import type { HqPlusBadge } from '../../../../../shared/hq-plus-kinds'
import { HqPlusBadges } from './HqPlusBadge'
import { HqPlusText } from './HqPlusText'
import { HqPlusChatName, type HqPlusChatRef } from './HqPlusChatName'
import { hqPlusSourceLabel } from './hq-plus-source-label'
import type { HqPlusLinkClick } from './hq-plus-link-open'
import type { HqPlusResult } from './hq-plus-actions'

export type HqPlusCardButton = {
  id: string
  label: React.ReactNode
  hint?: string
  /** The card's first answer, filled; a ghost button is a quiet one (Not now, Got it, a link). */
  main?: boolean
  ghost?: boolean
  disabled?: boolean
  /** The pressed button of a slow action, so it shows that it works. */
  pending?: boolean
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void
}

export function HqPlusCardButtons({
  buttons
}: {
  buttons: readonly HqPlusCardButton[]
}): React.JSX.Element | null {
  if (buttons.length === 0) {
    return null
  }
  return (
    <div className="hqp-opts">
      {buttons.map((button) => (
        <button
          key={button.id}
          type="button"
          className="hqp-opt"
          data-main={button.main ? 'true' : undefined}
          data-ghost={button.ghost ? 'true' : undefined}
          aria-busy={button.pending ? 'true' : undefined}
          disabled={button.disabled}
          title={button.hint}
          onClick={button.onClick}
        >
          {button.label}
        </button>
      ))}
    </div>
  )
}

/** Where a card came from — the Slack thread, ClickUp task or MR — as «Slack ↗». */
export function hqPlusSourceButton(
  url: string,
  onOpen: (url: string, event?: HqPlusLinkClick) => void
): HqPlusCardButton {
  return {
    id: 'source',
    label: `${hqPlusSourceLabel(url)} ↗`,
    ghost: true,
    onClick: (event) => onOpen(url, event)
  }
}

export function HqPlusCardSource({
  url,
  onOpen
}: {
  url: string
  onOpen: (url: string, event?: HqPlusLinkClick) => void
}): React.JSX.Element {
  return (
    <button type="button" className="hqp-link hqp-source" onClick={(event) => onOpen(url, event)}>
      {hqPlusSourceLabel(url)} ↗
    </button>
  )
}

/** One head for every card: badges, who and where, the chat's name, the time; the right end after. */
export function HqPlusCardHead({
  badges,
  lead,
  chat,
  onOpenChat = null,
  when,
  extra,
  right
}: {
  badges: readonly HqPlusBadge[]
  /** Who or what the card is about: the project, the person, a note beside it. */
  lead: React.ReactNode
  chat: HqPlusChatRef | null
  onOpenChat?: (() => void) | null
  when: string
  /** After the time: the thread's address. */
  extra?: React.ReactNode
  /** The right end: the source, a state, ×, «Open». */
  right?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="hqp-row-h">
      <HqPlusBadges badges={badges} />
      {lead}
      <HqPlusChatName chat={chat} onOpen={onOpenChat} />
      <span className="hqp-tm">{when}</span>
      {extra}
      <span className="hqp-spacer" />
      {right}
    </div>
  )
}

/** A card folded to two lines: what it is about, and what became of it; a click opens it. */
export function HqPlusCardFold({
  line,
  done,
  onOpen
}: {
  line: string
  done: string | null
  onOpen: () => void
}): React.JSX.Element {
  return (
    <button type="button" className="hqp-cc" aria-expanded="false" onClick={onOpen}>
      <span className="l1">
        <HqPlusText text={line} maxLines={1} />
      </span>
      {done ? <span className="l2">✓ {done}</span> : null}
    </button>
  )
}

type ShellAttributes = Omit<React.HTMLAttributes<HTMLDivElement>, 'className'> &
  Record<`data-${string}`, string | undefined>

const NO_BUTTONS: readonly HqPlusCardButton[] = []

export function HqPlusCardShell({
  className = 'hqp-card',
  padded = true,
  head,
  folded,
  children,
  done,
  buttons = NO_BUTTONS,
  composer,
  trailing = NO_BUTTONS,
  error,
  footer,
  ...attributes
}: ShellAttributes & {
  className?: string
  /** The open card's parts sit in the padded column (hqp-cb); a chat's card is its own column. */
  padded?: boolean
  head: React.ReactNode
  /** Folded, the card is its head and this line, nothing else. */
  folded?: React.ReactNode
  children?: React.ReactNode
  /** What became of the card, as «✓ sent · 14:02». */
  done?: string | null
  buttons?: readonly HqPlusCardButton[]
  /** The reply box: an HqPlusComposer, or a thread's composer built on it. */
  composer?: React.ReactNode
  /** Buttons that stand under the reply box (Not now). */
  trailing?: readonly HqPlusCardButton[]
  error?: string | null
  /** The bottom line: an address on the left, «Collapse» and the right end's buttons. */
  footer?: { left?: React.ReactNode; onCollapse?: (() => void) | null; right?: React.ReactNode }
}): React.JSX.Element {
  if (folded) {
    return (
      <div className={className} {...attributes}>
        {head}
        {folded}
      </div>
    )
  }
  const parts = (
    <>
      {head}
      {children}
      {done ? <p className="hqp-done">✓ {done}</p> : null}
      <HqPlusCardButtons buttons={buttons} />
      {composer}
      <HqPlusCardButtons buttons={trailing} />
      {error ? <p className="hqp-error">{error}</p> : null}
      {footer && (footer.left || footer.onCollapse || footer.right) ? (
        <div className="hqp-row-f">
          {footer.left}
          <span className="hqp-spacer" />
          {footer.onCollapse ? (
            <button type="button" className="hqp-pill" onClick={footer.onCollapse}>
              {translate('auto.hqPlus.collapseCard', 'Collapse')}
            </button>
          ) : null}
          {footer.right}
        </div>
      ) : null}
    </>
  )
  return (
    <div className={className} {...attributes}>
      {padded ? <div className="hqp-cb">{parts}</div> : parts}
    </div>
  )
}

/**
 * One way a card runs what a button or the reply box asks: one action at a time, the pressed button
 * marked while it works, a failure shown on the card; `onDone` runs after a success.
 */
export function useHqPlusRun(onDone: () => void): {
  busy: boolean
  pending: string | null
  error: string | null
  run: (action: () => Promise<HqPlusResult>, key?: string | null) => void
} {
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const run = (action: () => Promise<HqPlusResult>, key: string | null = null): void => {
    if (busy) {
      return
    }
    setBusy(true)
    setPending(key)
    setError(null)
    void action()
      .then((result) => {
        if (result.ok) {
          onDone()
        } else {
          setError(result.message)
        }
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => {
        setBusy(false)
        setPending(null)
      })
  }
  return { busy, pending, error, run }
}
