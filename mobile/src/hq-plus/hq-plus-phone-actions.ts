// Custom build (hq-plus-phone): what a card's buttons do on the phone, through the paths the
// desktop's HQ+ uses — `chat.send` into the card's thread, the bell's done mark, a wait closed as
// `orca pulse wait` does, a bell button pressed in the Mac's window. Approvals are refused by the Mac.
import { HQ_PLUS_REPLY_ACTION, type HqPlusCard } from '../../../src/shared/hq-plus-log'
import { hqBellActionOnDesktop, hqWaitingClose } from '../hq/hq-operations'
import { errorText } from '../hq/use-mobile-hq-poll'
import { runRpcOperation } from '../transport/rpc-operation'
import type { RpcClient } from '../transport/rpc-client'
import { hqPlusAskHq, hqPlusChatSend, hqPlusMarkDone } from './hq-plus-phone-operations'

export type HqPlusPhoneResult = { ok: true } | { ok: false; message: string }

const OK: HqPlusPhoneResult = { ok: true }
const REPLY_KEEP = 300

async function attempt(run: () => Promise<HqPlusPhoneResult>): Promise<HqPlusPhoneResult> {
  try {
    return await run()
  } catch (error) {
    return { ok: false, message: errorText(error) }
  }
}

export function markHqPlusPhoneDone(
  client: RpcClient,
  card: HqPlusCard,
  action: string,
  overAutoClose = false
): Promise<HqPlusPhoneResult> {
  const item = card.inbox
  if (!item || (item.doneAt && !overAutoClose)) {
    return Promise.resolve(OK)
  }
  return attempt(async () => {
    await runRpcOperation(client, hqPlusMarkDone, { id: item.id, action })
    return OK
  })
}

/** The owner's words into the card's thread; then the bell item keeps them for the folded card. */
export function replyOnHqPlusPhoneCard(
  client: RpcClient,
  card: HqPlusCard,
  text: string,
  hqPath: string | null
): Promise<HqPlusPhoneResult> {
  const words = text.trim()
  const address = card.address
  if (!words) {
    return Promise.resolve(OK)
  }
  if (!address) {
    return Promise.resolve({ ok: false, message: 'This chat has no thread; open it to answer.' })
  }
  return attempt(async () => {
    await runRpcOperation(client, hqPlusChatSend, {
      address,
      text: words,
      ...(card.entry?.id ? { replyTo: card.entry.id } : {}),
      ...(hqPath ? { callerCwd: hqPath } : {})
    })
    return markHqPlusPhoneDone(
      client,
      card,
      `${HQ_PLUS_REPLY_ACTION}${words.slice(0, REPLY_KEEP)}`,
      true
    )
  })
}

/** A wait on the owner closes the way `orca pulse wait done|drop` does. */
export function closeHqPlusPhoneWait(
  client: RpcClient,
  card: HqPlusCard,
  status: 'resolved' | 'cancelled'
): Promise<HqPlusPhoneResult> {
  const id = card.entry?.refKind === 'waiting' ? card.entry.refId : null
  if (!id) {
    return Promise.resolve(OK)
  }
  return attempt(async () => {
    await runRpcOperation(client, hqWaitingClose, { id, status, resolution: 'HQ+' })
    return OK
  })
}

/** A bell button runs in the Mac's window, where its code lives (a new session, an answer passed on). */
export function runHqPlusPhoneBellAction(
  client: RpcClient,
  card: HqPlusCard,
  actionId: string
): Promise<HqPlusPhoneResult> {
  const item = card.inbox
  if (!item) {
    return Promise.resolve(OK)
  }
  return attempt(async () => {
    const reply = await runRpcOperation(client, hqBellActionOnDesktop, {
      itemId: item.id,
      actionId
    })
    return reply.ok ? OK : { ok: false, message: reply.error }
  })
}

/** «Write to HQ»: the question goes to the Ask HQ chat in the Mac's window. */
export function askHqFromPhone(client: RpcClient, text: string): Promise<HqPlusPhoneResult> {
  const words = text.trim()
  if (!words) {
    return Promise.resolve(OK)
  }
  return attempt(async () => {
    const reply = await runRpcOperation(client, hqPlusAskHq, { text: words })
    return reply.ok ? OK : { ok: false, message: reply.error }
  })
}
