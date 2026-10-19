// Custom build (ship-restart-notice): scripts/orca-plus-ship.sh leaves a marker naming the chat it
// ran from; after the restart that chat gets one message to check the ship, then the marker goes.
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { getAppEnvironment } from '../../../shared/app-environment'
import { mintAgentSessionOperationId } from '../../runtime/orchestration/structured-pointer-operation-id'
import { deliverToNativeChat } from '../waiting-replies/deliver-waiting-reply'

export const SHIP_RESTART_MARKER_FILE = 'orca-plus-ship-restart.json'
// Why: an older marker is from a ship that never restarted; the chat has moved on.
export const SHIP_RESTART_MAX_AGE_MS = 30 * 60_000
// Why: the chat host and its records come up after startup; a closed chat may need a few tries.
const RETRY_MS = 15_000

export type ShipRestartMarker = {
  agentSessionId: string
  sha: string
  writtenAt: number
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
  const agentSessionId = Reflect.get(value, 'agentSessionId')
  const sha = Reflect.get(value, 'sha')
  const writtenAt = Date.parse(String(Reflect.get(value, 'writtenAt')))
  if (typeof agentSessionId !== 'string' || !agentSessionId || typeof sha !== 'string' || !sha) {
    return null
  }
  return Number.isFinite(writtenAt) ? { agentSessionId, sha, writtenAt } : null
}

export function shipRestartPrompt(sha: string): string {
  return `Orca+ перезапущена на \`${sha}\` — проверь, что выкатка встала`
}

export type ShipRestartNoticeDeps = {
  readMarker: () => Promise<string | null>
  removeMarker: () => Promise<void>
  /** True once the chat took the message, sent or queued. */
  deliver: (sessionId: string, prompt: string) => Promise<boolean>
  now: () => number
  schedule: (run: () => void, ms: number) => void
}

/** Reads the marker once; delivers with retries until it lands or the marker ages out. */
export async function runShipRestartNotice(deps: ShipRestartNoticeDeps): Promise<void> {
  const text = await deps.readMarker()
  if (text === null) {
    return
  }
  const marker = parseShipRestartMarker(text)
  const attempt = async (): Promise<void> => {
    if (!marker || deps.now() - marker.writtenAt > SHIP_RESTART_MAX_AGE_MS) {
      await deps.removeMarker()
      return
    }
    const delivered = await deps
      .deliver(marker.agentSessionId, shipRestartPrompt(marker.sha))
      .catch((error: unknown) => {
        console.warn('[ship-restart-notice] delivery failed:', error)
        return false
      })
    if (delivered) {
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
  // Why one id: a retry of an attempt the host did take replays its answer instead of a second turn.
  const operationId = mintAgentSessionOperationId(Date.now())
  void runShipRestartNotice({
    readMarker: () => readFile(path, 'utf8').catch(() => null),
    removeMarker: () => rm(path, { force: true }),
    deliver: (sessionId, prompt) =>
      deliverToNativeChat(sessionId, prompt, 'ship-restart-notice', operationId),
    now: Date.now,
    schedule: (run, ms) => setTimeout(run, ms).unref?.()
  }).catch(warn)
}
