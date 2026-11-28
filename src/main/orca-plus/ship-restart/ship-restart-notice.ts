// Custom build (ship-restart-notice): scripts/orca-plus-ship.sh leaves a marker naming the chat it
// ran from; after the restart that chat gets one message to check the ship, then the marker goes.
// A9 (wave 2): the marker also lists the chats a restart cuts off — a turn in flight, or a chat
// active lately whose ScheduleWakeup, Monitor or background command dies with Orca+ — and each of
// them is told to re-arm, since the CLI does not bring those back.
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { getAppEnvironment } from '../../../shared/app-lifecycle/app-environment'
import { mintAgentSessionOperationId } from '../../runtime/orchestration/mailbox/structured-pointer/structured-pointer-operation-id'
import { deliverToNativeChat } from '../waiting-replies/deliver-waiting-reply'

export const SHIP_RESTART_MARKER_FILE = 'orca-plus-ship-restart.json'
// Why: an older marker is from a ship that never restarted; the chat has moved on.
export const SHIP_RESTART_MAX_AGE_MS = 30 * 60_000
// Why: the chat host and its records come up after startup; a closed chat may need a few tries.
const RETRY_MS = 15_000

export type ShipRestartMarker = {
  /** The chat that ran the ship; null for a ship started from a terminal. */
  agentSessionId: string | null
  sha: string
  writtenAt: number
  /** A9: chats whose alarms or turn the restart cut off. */
  chats: string[]
}

export function parseShipRestartMarker(text: string): ShipRestartMarker | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const rawSession = Reflect.get(value, 'agentSessionId')
  const agentSessionId = typeof rawSession === 'string' && rawSession ? rawSession : null
  const sha = Reflect.get(value, 'sha')
  const writtenAt = Date.parse(String(Reflect.get(value, 'writtenAt')))
  const rawChats = Reflect.get(value, 'chats')
  const chats = Array.isArray(rawChats)
    ? [...new Set(rawChats.filter((id): id is string => typeof id === 'string' && id !== ''))]
    : []
  if (typeof sha !== 'string' || !sha || (!agentSessionId && chats.length === 0)) {
    return null
  }
  return Number.isFinite(writtenAt) ? { agentSessionId, sha, writtenAt, chats } : null
}

export function shipRestartPrompt(sha: string): string {
  return `Orca+ перезапущена на \`${sha}\` — проверь, что выкатка встала`
}

/** A9: for a chat the restart cut off — its alarms and background commands are gone. */
export function restartAlarmsPrompt(sha: string): string {
  return (
    `Orca+ перезапущена на \`${sha}\` (выкатка). ScheduleWakeup, Monitor и фоновые команды этого чата ` +
    'сняты, ход в работе оборван. Ждал чего-то — поставь будильник заново; ход не закончен — продолжи; ' +
    'нечего ждать — ответь одной строкой.'
  )
}

/** Who gets what: the shipping chat checks the ship; every other listed chat re-arms. */
export function shipRestartDeliveries(marker: ShipRestartMarker): Map<string, string> {
  const out = new Map<string, string>()
  if (marker.agentSessionId) {
    out.set(marker.agentSessionId, shipRestartPrompt(marker.sha))
  }
  for (const chat of marker.chats) {
    if (!out.has(chat)) {
      out.set(chat, restartAlarmsPrompt(marker.sha))
    }
  }
  return out
}

export type ShipRestartNoticeDeps = {
  readMarker: () => Promise<string | null>
  removeMarker: () => Promise<void>
  /** True once the chat took the message, sent or queued. */
  deliver: (sessionId: string, prompt: string) => Promise<boolean>
  now: () => number
  /** When this app process started; a start held up (the Keychain window) must not age the marker. */
  startedAt: number
  schedule: (run: () => void, ms: number) => void
}

/** Reads the marker once; delivers with retries until every chat has it or the marker ages out. */
export async function runShipRestartNotice(deps: ShipRestartNoticeDeps): Promise<void> {
  const text = await deps.readMarker()
  if (text === null) {
    return
  }
  const marker = parseShipRestartMarker(text)
  const pending = marker ? shipRestartDeliveries(marker) : new Map<string, string>()
  const firstTry = deps.now()
  const attempt = async (): Promise<void> => {
    // Why: a marker written long before this launch is a ship that never restarted; once launched,
    // the chat gets the same span to take the message, however long the start itself took (24.10: 33 min).
    if (
      !marker ||
      deps.startedAt - marker.writtenAt > SHIP_RESTART_MAX_AGE_MS ||
      deps.now() - firstTry > SHIP_RESTART_MAX_AGE_MS
    ) {
      await deps.removeMarker()
      return
    }
    // Why one by one: the host is shared, and a burst of turns at startup is what it least needs.
    for (const [sessionId, prompt] of [...pending]) {
      const delivered = await deps.deliver(sessionId, prompt).catch((error: unknown) => {
        console.warn('[ship-restart-notice] delivery failed:', error)
        return false
      })
      if (delivered) {
        pending.delete(sessionId)
      }
    }
    if (pending.size === 0) {
      await deps.removeMarker()
      return
    }
    deps.schedule(() => void attempt().catch(warn), RETRY_MS)
  }
  await attempt()
}

function warn(error: unknown): void {
  console.warn('[ship-restart-notice] failed:', error)
}

export function startShipRestartNotice(): void {
  const path = join(getAppEnvironment().getPath('userData'), SHIP_RESTART_MARKER_FILE)
  // Why one id per chat: a retry of an attempt the host did take replays its answer instead of a
  // second turn.
  const operationIds = new Map<string, string>()
  const operationIdFor = (sessionId: string): string => {
    const id = operationIds.get(sessionId) ?? mintAgentSessionOperationId(Date.now())
    operationIds.set(sessionId, id)
    return id
  }
  void runShipRestartNotice({
    readMarker: () => readFile(path, 'utf8').catch(() => null),
    removeMarker: () => rm(path, { force: true }),
    deliver: (sessionId, prompt) =>
      deliverToNativeChat(sessionId, prompt, 'ship-restart-notice', operationIdFor(sessionId)),
    now: Date.now,
    startedAt: Date.now() - process.uptime() * 1000,
    schedule: (run, ms) => setTimeout(run, ms).unref?.()
  }).catch(warn)
}
