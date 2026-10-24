// Custom build (hq-plus-ui): what a card's buttons do, through the paths the rest of Orca+ already
// uses — `chat.send` into a thread, the bell's own done marks, waits closed as `orca pulse wait` does,
// a report handed to an HQ chat, and the Codex rule run now.
import { HQ_PLUS_REPLY_ACTION, type HqPlusCard } from '../../../../../shared/hq-plus-log'
import { HQ_FIX_NOW_DONE_PREFIX, hqFixNowSummary } from '../../../../../shared/hq-fix-now'
import type { HqReport } from '../../../../../shared/hq-reports'
import { translate } from '@/i18n/i18n'
import { startHqChatWithPrompt, startHqReportDecisions } from '../hq/hq-ask-chat'
import { hqPlusCall } from './use-hq-plus-data'
import { hqResultField } from '../../../../../shared/hq-plus-rpc-readers'
import { readPulseBellPaneRef, type PulseBellPaneRef } from '../../../../../shared/pulse-bell'
import { parsePaneKey } from '../../../../../shared/stable-pane-id'
import { sendBracketedPasteToRunningAgent } from '@/lib/agent-paste-draft'
import { useAppStore } from '@/store'

export type HqPlusResult = { ok: true } | { ok: false; message: string }

const OK: HqPlusResult = { ok: true }
const REPLY_KEEP = 300

function noBell(): HqPlusResult {
  return {
    ok: false,
    message: translate(
      'auto.hqPlus.noBell',
      'This window cannot reach the bell; answer on the Mac.'
    )
  }
}

export async function markHqPlusDone(
  card: HqPlusCard,
  action: string,
  overAutoClose = false
): Promise<HqPlusResult> {
  if (!card.inbox || (card.inbox.doneAt && !overAutoClose)) {
    return OK
  }
  const bell = window.api.pulseBell
  if (!bell) {
    return noBell()
  }
  await bell.markDone(card.inbox.id, action)
  return OK
}

/** Where the owner's words go: a thread by its address, else a chat by its session. */
export type HqPlusChatTarget = {
  address: string | null
  sessionId: string | null
  /** The journal row being answered, quoted to the agent. */
  replyTo: string | null
  /** What the agent is reminded of when there is no thread to quote. */
  about: string | null
  /** Custom build (hq-closed-loop): a terminal agent (an automation's run) has a pane, no chat. */
  pane?: PulseBellPaneRef | null
}

/** The owner's words typed into a terminal agent's prompt, as a paste plus Enter. */
async function sendIntoHqPlusPane(pane: PulseBellPaneRef, prompt: string): Promise<HqPlusResult> {
  const parsed = parsePaneKey(pane.paneKey)
  const tabId = pane.tabId ?? parsed?.tabId ?? null
  const ptyId =
    tabId && parsed
      ? useAppStore.getState().terminalLayoutsByTabId[tabId]?.ptyIdsByLeafId?.[parsed.leafId]
      : undefined
  const sent = ptyId ? await sendBracketedPasteToRunningAgent({ ptyId, content: prompt }) : false
  return sent
    ? OK
    : {
        ok: false,
        message: translate(
          'auto.hqPlus.paneClosed',
          'The terminal of this run is closed; nothing was sent.'
        )
      }
}

/** The owner's words into a chat: by its thread when it has one, else straight to the chat. */
export async function sendIntoHqPlusChat(
  target: HqPlusChatTarget,
  text: string,
  hqPath: string | null
): Promise<HqPlusResult> {
  const words = text.trim()
  if (!words) {
    return OK
  }
  if (target.address) {
    const sent = await hqPlusCall('chat.send', {
      address: target.address,
      text: words,
      ...(target.replyTo ? { replyTo: target.replyTo } : {}),
      ...(hqPath ? { callerCwd: hqPath } : {})
    })
    return sent.ok ? OK : sent
  }
  if (!target.sessionId && target.pane) {
    return sendIntoHqPlusPane(
      target.pane,
      `${target.about ? `Orca+ · the owner answered from HQ+ («${target.about}»): ` : ''}${words}`
    )
  }
  const bell = window.api.pulseBell
  if (!target.sessionId || !bell) {
    return {
      ok: false,
      message: translate('auto.hqPlus.noChat', 'This has no chat to answer; open it instead.')
    }
  }
  const prompt = [
    target.about
      ? `Orca+ · the owner answered your last turn from HQ+ («${target.about}»):`
      : 'Orca+ · the owner wrote to this chat from HQ+:',
    '"""',
    words,
    '"""'
  ].join('\n')
  const taken = await bell.sendToChat(target.sessionId, prompt)
  return taken.ok
    ? OK
    : {
        ok: false,
        message: translate(
          'auto.hqPlus.chatClosed',
          'The chat is closed; open it from History and answer there.'
        )
      }
}

/** A card's answer goes to its chat, then the bell item keeps the words for the folded card. */
export async function replyOnHqPlusCard(
  card: HqPlusCard,
  text: string,
  hqPath: string | null
): Promise<HqPlusResult> {
  const words = text.trim()
  const sent = await sendIntoHqPlusChat(
    {
      address: card.address,
      sessionId: card.sessionId,
      replyTo: card.entry?.id ?? null,
      about: card.title,
      pane: card.inbox ? readPulseBellPaneRef(card.inbox.refId) : null
    },
    words,
    hqPath
  )
  if (!sent.ok || !words) {
    return sent
  }
  // Why: the chat working again closes its finished turn by itself; the owner's words replace that.
  return markHqPlusDone(card, `${HQ_PLUS_REPLY_ACTION}${words.slice(0, REPLY_KEEP)}`, true)
}

/** Custom build (hq-closed-loop): a background job's card answered — the words wait in the job's
 *  thread for its next run. */
export async function replyOnHqPlusJob(card: HqPlusCard, text: string): Promise<HqPlusResult> {
  const words = text.trim()
  if (!words || !card.entry) {
    return OK
  }
  const sent = await hqPlusCall('hq.jobReply', { entryId: card.entry.id, text: words })
  return sent.ok ? OK : sent
}

/** «Tell agent» on a held message: not sent; the drafting chat gets the owner's words and drafts again. */
export async function tellHqPlusDraftingAgent(
  card: HqPlusCard,
  text: string
): Promise<HqPlusResult> {
  const note = text.trim()
  const draftId = card.inbox?.refId ?? null
  if (!note || !draftId) {
    return OK
  }
  await window.api.outgoingApproval.decide(draftId, 'rejected', undefined, { note })
  return OK
}

/** A wait on the owner closes the same way `orca pulse wait done|drop` does. */
export async function closeHqPlusWait(
  card: HqPlusCard,
  status: 'resolved' | 'cancelled'
): Promise<HqPlusResult> {
  const id = card.entry?.refKind === 'waiting' ? card.entry.refId : null
  if (!id) {
    return OK
  }
  const closed = await hqPlusCall('pulse.closeWaiting', { id, status, resolution: 'HQ+' })
  return closed.ok ? OK : closed
}

export function hqPlusReportOf(
  card: HqPlusCard
): Pick<HqReport, 'path' | 'folder' | 'title'> | null {
  const path = card.inbox?.refId ?? null
  if (!path) {
    return null
  }
  const parts = path.split('/')
  const folder = parts.at(-2)
  if (
    folder !== 'improvements' &&
    folder !== 'meetings' &&
    folder !== 'status-update' &&
    folder !== 'updates' &&
    folder !== 'daily'
  ) {
    return null
  }
  return { path, folder, title: card.body ?? card.title }
}

export function isHqCodexReview(path: string): boolean {
  return /(^|\/)updates\/codex-review-[^/]+\.md$/.test(path)
}

/** The report goes to a new HQ chat with the owner's words, as Reports' «Send decisions» does. */
export async function sendHqPlusReport(
  card: HqPlusCard,
  text: string,
  hqWorktreeId: string | null,
  action: string
): Promise<HqPlusResult> {
  const report = hqPlusReportOf(card)
  if (!report) {
    return OK
  }
  if (!hqWorktreeId) {
    return {
      ok: false,
      message: translate(
        'auto.hq.reports.noHq',
        'Add the HQ folder as a project to send decisions.'
      )
    }
  }
  const started = await startHqReportDecisions(hqWorktreeId, report, text)
  if (!started.ok) {
    return { ok: false, message: started.message }
  }
  return markHqPlusDone(card, action)
}

const FIX_WINDOW_MS = 36 * 60 * 60_000

/** «Fix now»: the owner agreed to fix the whole report — every finding no chat has yet gets one, now.
 *  Custom build (hq-fix-now-all): the card keeps the result line, never a bare «nothing opened». */
export async function runHqPlusCodexFix(
  card: HqPlusCard,
  hqPath: string | null
): Promise<HqPlusResult> {
  const report = hqPlusReportOf(card)?.path ?? null
  // Why: an older host drops `report`; `since` keeps its routing to this report's window.
  const ran = await hqPlusCall('hq.route', {
    run: true,
    now: true,
    since: (card.inbox?.createdAt ?? card.at) - FIX_WINDOW_MS,
    ...(report ? { report } : {}),
    ...(hqPath ? { callerCwd: hqPath } : {})
  })
  if (!ran.ok) {
    return ran
  }
  const actions = hqResultField(ran.result, 'actions')
  const handled = hqResultField(ran.result, 'handled')
  const summary = hqFixNowSummary({
    actions: Array.isArray(actions) ? actions : [],
    handled: Array.isArray(handled) ? handled : []
  })
  // Why: only a report-aware host answers with `handled`; an older one routed by time, not this report.
  if (report && !Array.isArray(handled)) {
    return {
      ok: false,
      message: `${summary.text}. This Orca+ host is older and fixed by time, not by this report — update it, then press Fix now again.`
    }
  }
  // Why: closing the report would hide findings no chat took up — a project waiting or not started.
  return summary.ok && summary.complete
    ? markHqPlusDone(card, `${HQ_FIX_NOW_DONE_PREFIX}${summary.text}`)
    : { ok: false, message: summary.text }
}

/** Custom build (hq-plus-ui-v4): «Done» closes what the card stands for — a waiting on the owner, else its
 *  bell item; an Approve card is answered on the card itself. */
export function canFinishHqPlusCard(card: HqPlusCard): boolean {
  return card.type !== 'approve' && (card.type === 'wait' || card.inbox !== null)
}

export function finishHqPlusCard(card: HqPlusCard): Promise<HqPlusResult> {
  return card.type === 'wait' ? closeHqPlusWait(card, 'resolved') : markHqPlusDone(card, 'done')
}

/** Custom build (hq-plus-side-blocks): an agent's own draft (no held call) — handed on or dropped. */
export async function settleHqPlusAgentDraft(
  card: HqPlusCard,
  outcome: 'approved' | 'rejected'
): Promise<HqPlusResult> {
  const id = card.entry?.refKind === 'draft' ? card.entry.refId : null
  if (!id) {
    return { ok: false, message: 'This card has no draft.' }
  }
  try {
    await window.api.outgoingApproval.settleAgentDraft(id, outcome)
    return { ok: true }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

/** An HQ chat sends the agent's draft as written; its send still stops at the owner's Approve. */
export async function sendHqPlusAgentDraft(
  card: HqPlusCard,
  hqWorktreeId: string | null
): Promise<HqPlusResult> {
  if (!hqWorktreeId) {
    return { ok: false, message: 'The HQ workspace is not open in Orca.' }
  }
  const where = card.title.replace(/^Approve:\s*/, '').replace(/^message → /, '')
  const prompt = [
    `Отправь это сообщение ровно как есть, ничего не меняя. Куда: ${where}.`,
    'Отправка пройдёт через Approve — я подтвержу в карточке.',
    '',
    card.body ?? ''
  ].join('\n')
  const started = await startHqChatWithPrompt(hqWorktreeId, prompt, `Send · ${where}`.slice(0, 60))
  if (!started.ok) {
    return started
  }
  return settleHqPlusAgentDraft(card, 'approved')
}
