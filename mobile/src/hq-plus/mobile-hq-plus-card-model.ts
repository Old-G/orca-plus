// Custom build (hq-plus-phone): what a decision card says and offers on the phone — the desktop
// card's question, its buttons' names and hints, where it came from and how it was settled.
import type { HqPlusCard, HqPlusDone } from '../../../src/shared/hq-plus-log'
import {
  HQ_PLUS_DONE_HANDED_OFF,
  HQ_PLUS_DONE_IN_CHAT,
  HQ_PLUS_QUESTION_LINE,
  hqPlusChoices
} from '../../../src/shared/hq-plus-log'
import type { HqPlusLook } from '../../../src/shared/hq-plus-kinds'
import { PULSE_BELL_ACTION } from '../../../src/shared/pulse-bell'
import { hqSourceService, type HqSourceService } from '../../../src/shared/hq-source-link'
import { readHqSlackRequestRef } from '../../../src/shared/hq-slack-request-bell'
import {
  HQ_WAITING_REPLY_ACTION,
  readHqWaitingReplyRef
} from '../../../src/shared/hq-waiting-reply-bell'
import { HQ_FIX_NOW_DONE_PREFIX } from '../../../src/shared/hq-fix-now'
import { HQ_REPORT_FOLDERS } from '../../../src/shared/hq-reports'
import { clock } from './mobile-hq-plus-parts'

export type HqpCardAction = { id: string; label: string; hint?: string; ghost?: boolean }

/** Buttons that open the card's chat: the phone opens it here, not in the Mac's window. */
export const HQP_OPEN_CHAT_ACTIONS: ReadonlySet<string> = new Set([
  HQ_WAITING_REPLY_ACTION.open,
  PULSE_BELL_ACTION.open
])

const INBOX_ACTION_LABEL: Readonly<Record<string, string>> = {
  'slack-do': 'To work',
  'intake-open': 'To work',
  'slack-answer': 'Reply',
  'slack-review': 'Investigate'
}

const DONE_ACTION: Readonly<Record<string, string>> = {
  open: 'opened',
  dismiss: 'not now',
  seen: 'got it',
  done: 'done',
  'fix-now': 'fixing chats opened',
  'wait-rule': 'left to the evening rule',
  review: 'handed to an HQ chat',
  accept: 'proposals accepted',
  approve: 'sent',
  reject: 'rejected',
  edit: 'edited and sent'
}

export function hqpDoneLabel(done: HqPlusDone): string {
  if (done.by === 'reply') {
    const text = done.text.length > 80 ? `${done.text.slice(0, 78)}…` : done.text
    return `you: «${text}» · ${clock(done.at)}`
  }
  if (done.by === 'status') {
    return done.status === 'superseded'
      ? 'a newer report came'
      : done.status === HQ_PLUS_DONE_IN_CHAT
        ? 'answered in the chat'
        : done.status === HQ_PLUS_DONE_HANDED_OFF
          ? 'a new chat took it over'
          : done.status === 'dropped'
            ? 'dropped'
            : 'closed'
  }
  if (done.action?.startsWith(HQ_FIX_NOW_DONE_PREFIX)) {
    return done.action.slice(HQ_FIX_NOW_DONE_PREFIX.length)
  }
  const label = (done.action ? DONE_ACTION[done.action] : undefined) ?? 'decided'
  return done.at ? `${label} · ${clock(done.at)}` : label
}

/** The question a turn ends on, else its title — as the desktop card shows it. */
export function hqpQuestionOf(card: HqPlusCard): string {
  if (card.report?.ask) {
    return card.report.ask
  }
  if (card.job && card.report?.learned) {
    return card.report.learned
  }
  const lines = (card.body ?? '').split('\n').map((line) => line.replace(/\*\*/g, '').trim())
  return lines.toReversed().find((line) => HQ_PLUS_QUESTION_LINE.test(line)) ?? card.title
}

export function hqpChoices(card: HqPlusCard): string[] {
  return card.report?.options.length ? card.report.options : hqPlusChoices(card.body)
}

/** The bell buttons a card offers, named as on the desktop; a person's answer says what each does. */
export function hqpInboxActions(card: HqPlusCard, look: HqPlusLook): HqpCardAction[] {
  const actions = card.inbox?.actions ?? []
  if (card.type === 'reply') {
    const author = readHqWaitingReplyRef(card.inbox?.refId ?? null)?.author ?? 'the person'
    return actions.map((action) => {
      switch (action.id) {
        case HQ_WAITING_REPLY_ACTION.deliver:
          return {
            id: action.id,
            label: 'Send answer to chat',
            hint: `Sends ${author}’s answer to the chat that asked, and the chat carries on with it`
          }
        case HQ_WAITING_REPLY_ACTION.open:
          return { id: action.id, label: 'Open chat' }
        case HQ_WAITING_REPLY_ACTION.skip:
          return { id: action.id, label: action.label, ghost: true }
        default:
          return action
      }
    })
  }
  if (look.kind !== 'inbox') {
    return actions.map((action) =>
      action.id === PULSE_BELL_ACTION.dismiss ? { ...action, ghost: true } : action
    )
  }
  const picked = actions.flatMap((action) => {
    const label = INBOX_ACTION_LABEL[action.id]
    return label ? [{ id: action.id, label }] : []
  })
  return picked.length > 0 ? picked : actions
}

/** A word beside the badges: which report, what the person wants from the owner. */
export function hqpNoteOf(card: HqPlusCard, reportFolder: string | null): string | null {
  if (card.type === 'report') {
    return reportFolder
  }
  if (card.type !== 'bell') {
    return null
  }
  const ask = readHqSlackRequestRef(card.inbox?.refId ?? null)?.kind
  return ask === 'answer' ? 'wants your answer' : ask === 'do' ? 'asks you to do it' : null
}

function linkOfRef(refId: string | null): string | null {
  try {
    const parsed: unknown = refId ? JSON.parse(refId) : null
    const raw: unknown =
      parsed && typeof parsed === 'object'
        ? (Reflect.get(parsed, 'link') ?? Reflect.get(parsed, 'permalink'))
        : null
    return typeof raw === 'string' ? raw : null
  } catch {
    return null
  }
}

const SOURCE_LABEL: Readonly<Record<HqSourceService, string>> = {
  slack: 'Slack',
  clickup: 'ClickUp',
  gmail: 'Gmail',
  gitlab: 'GitLab'
}

/** The Slack thread, ClickUp task or mail a card came from. */
export function hqpSourceLink(card: HqPlusCard): { url: string; label: string } | null {
  const raw = linkOfRef(card.inbox?.refId ?? null) ?? card.entry?.links[0]?.url ?? null
  if (!raw || !raw.startsWith('https://')) {
    return null
  }
  const service = hqSourceService(raw)
  return { url: raw, label: `${service ? SOURCE_LABEL[service] : 'Link'} ↗` }
}

/** A report card's file under HQ, when its bell item names one. */
export function hqpReportPath(card: HqPlusCard): { path: string; folder: string } | null {
  const path = card.inbox?.refId ?? null
  const folder = path?.split('/').at(-2) ?? null
  return path && folder && HQ_REPORT_FOLDERS.some((known) => known === folder)
    ? { path, folder }
    : null
}
