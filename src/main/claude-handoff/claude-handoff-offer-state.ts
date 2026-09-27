// Custom build (claude-handoff-launch): what decides an offer beyond the handoff file itself —
// whether Strata's context gate fired for the session, and which handoffs the user already answered.
import { existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeFileAtomically } from '../codex-accounts/fs-utils'
import type { ClaudeHandoffHandledStore } from './claude-handoff-offers'

const HANDLED_LIMIT = 200
const SAFE_SESSION_ID = /^[A-Za-z0-9._-]{1,128}$/

/** Strata's gate leaves `<dir>/<session>` when the context passed its threshold (STRATA_HANDOFF_PCT). */
export function strataContextGateFired(
  sessionId: string,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (!SAFE_SESSION_ID.test(sessionId)) {
    return false
  }
  const dir = env.STRATA_CONTEXT_GATE_DIR || join(env.TMPDIR || tmpdir(), 'strata-context-gate')
  return existsSync(join(dir, sessionId))
}

function readKeys(filePath: string): string[] {
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf-8'))
    return Array.isArray(parsed) ? parsed.filter((key) => typeof key === 'string') : []
  } catch {
    return []
  }
}

export function createFileHandledStore(filePath: string): ClaudeHandoffHandledStore {
  const keys = readKeys(filePath)
  return {
    has: (key) => keys.includes(key),
    add: (key) => {
      if (keys.includes(key)) {
        return
      }
      keys.push(key)
      keys.splice(0, Math.max(0, keys.length - HANDLED_LIMIT))
      try {
        writeFileAtomically(filePath, `${JSON.stringify(keys)}\n`)
      } catch (error) {
        console.warn('[claude-handoff] could not remember a handled handoff:', error)
      }
    }
  }
}
