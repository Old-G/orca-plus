// Custom build (chat-auto-effort-roles): a chat's role for its effort — the role it was launched with
// (Orca+ keeps it, hq-chat-roles), else «lead» for a chat a plan file in HQ/runs names on its
// «Lead chat:» line (a lead started before roles existed).
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentSessionRecord } from '../../../shared/agent-session/lifecycle/agent-session-record'
import { chatRoleOfSession } from '../../orca-plus/chat-roles/chat-role-env'
import { leadSessionIdsFromPlans, type ChatRole } from './chat-role-effort'

// Why: plan files change a few times a day; one read a minute is plenty and costs nothing per message.
const PLANS_KEPT_MS = 60_000

export type LeadPlanRegistryDeps = {
  hqPath: () => string | null | undefined
  /** The role the chat was launched with; null when it had none. */
  launchedRole?: (sessionId: string) => ChatRole | null
  now?: () => number
  listDir?: (dir: string) => Promise<string[]>
  readText?: (path: string) => Promise<string>
}

export function createChatRoleOf(
  deps: LeadPlanRegistryDeps
): (record: AgentSessionRecord) => Promise<ChatRole | null> {
  const now = deps.now ?? Date.now
  const listDir = deps.listDir ?? ((dir: string) => readdir(dir))
  const readText = deps.readText ?? ((path: string) => readFile(path, 'utf8'))
  const launchedRole = deps.launchedRole ?? chatRoleOfSession
  let kept: { at: number; hq: string; leads: Promise<Set<string>> } | null = null

  const leads = (hq: string): Promise<Set<string>> => {
    if (kept && kept.hq === hq && now() - kept.at < PLANS_KEPT_MS) {
      return kept.leads
    }
    const runs = join(hq, 'runs')
    const read = listDir(runs)
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name.endsWith('.md'))
            .map((name) => readText(join(runs, name)).catch(() => ''))
        )
      )
      .then(leadSessionIdsFromPlans)
      .catch(() => new Set<string>())
    kept = { at: now(), hq, leads: read }
    return read
  }

  return async (record) => {
    const stored = launchedRole(record.sessionId)
    if (stored) {
      return stored
    }
    const hq = deps.hqPath()
    return hq && (await leads(hq)).has(record.sessionId) ? 'lead' : null
  }
}
