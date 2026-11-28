// Custom build (hq-lead-of, A1 28.11): the Lead of a chat's plan, so a worker never looks the address up.
// The plan file is the source of truth (skill lead): its `Lead chat:` line names the Lead now — the
// handover sweep and `orca hq reassign` rewrite it — and a handoff on the Lead's own thread is followed
// to the chat that continues it. A chat's plan is the one in HQ/runs that names the chat in a row.
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { HqSession } from '../../shared/hq-journal'
import type { HqLeadResult } from '../../shared/hq-lead-of'
import { hqPlanLeadRefs } from './hq-lead-plan-line'

export type HqPlanText = { file: string; text: string; mtimeMs: number }

export type HqLeadOfDeps = {
  /** Every plan in HQ/runs (`*.md` at its top), newest first. */
  plans: () => Promise<HqPlanText[]>
  getSession: (sessionId: string) => HqSession | null
  listSessionsByAddress: (address: string) => HqSession[]
  liveSessionOf?: (sessionId: string) => string
  /** The chats with a tab open; null when they could not be read. */
  openTabs?: () => ReadonlySet<string> | null
}

export type HqLeadOfAsk = {
  /** The asking chat; its plan is found by its address or session id. */
  sessionId: string | null
  /** A plan file name in HQ/runs (with or without `.md`), or its path. */
  plan?: string
}

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SHORT_ID = 8

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** True when `text` holds `token` as a whole word: an address, a session id or its first 8 characters. */
function holds(text: string, token: string): boolean {
  return new RegExp(`(?:^|[^\\w/-])${escape(token)}(?![\\w/-])`).test(text)
}

function planName(plan: string): string {
  const base = plan.split('/').pop() ?? plan
  return base.endsWith('.md') ? base : `${base}.md`
}

/** Reads every plan of `<hq>/runs`, newest first. */
export async function hqReadPlanTexts(hqPath: string): Promise<HqPlanText[]> {
  const runs = join(hqPath, 'runs')
  const names = (await readdir(runs)).filter((name) => name.endsWith('.md'))
  const plans: HqPlanText[] = []
  for (const file of names) {
    const path = join(runs, file)
    const [text, info] = await Promise.all([readFile(path, 'utf8'), stat(path)])
    plans.push({ file, text, mtimeMs: info.mtimeMs })
  }
  return plans.sort((a, b) => b.mtimeMs - a.mtimeMs || a.file.localeCompare(b.file))
}

export function createHqLeadOf(deps: HqLeadOfDeps): (ask: HqLeadOfAsk) => Promise<HqLeadResult> {
  const isOpen = (open: ReadonlySet<string> | null, sessionId: string): boolean | null =>
    open ? open.has(sessionId) : null

  /** The chat a plan's Lead line names now, followed to the live end of its handoff chain. */
  const resolve = (
    plan: HqPlanText,
    words: readonly string[],
    open: ReadonlySet<string> | null
  ): HqLeadResult | null => {
    const named =
      words.find((word) => SESSION_ID.test(word) || deps.getSession(word) !== null) ?? null
    const address = words.find((word) => word.includes('/')) ?? null
    const onAddress = address ? deps.listSessionsByAddress(address) : []
    const start = named ?? onAddress[0]?.sessionId ?? null
    if (!start) {
      return null
    }
    let sessionId = deps.liveSessionOf?.(start) ?? start
    // Why: a Lead line can name a session the thread has since moved past without a recorded handoff;
    // the one open chat on the Lead's thread is the Lead then.
    if (open && !open.has(sessionId)) {
      const ends = [
        ...new Set(onAddress.map((s) => deps.liveSessionOf?.(s.sessionId) ?? s.sessionId))
      ]
      const live = ends.filter((id) => open.has(id))
      if (live.length === 1) {
        sessionId = live[0]
      }
    }
    return {
      plan: plan.file,
      address: deps.getSession(sessionId)?.address ?? address,
      sessionId,
      open: isOpen(open, sessionId),
      ...(sessionId !== start ? { handedOffFrom: start } : {})
    }
  }

  const leadOfPlan = (plan: HqPlanText, open: ReadonlySet<string> | null): HqLeadResult => {
    const refs = hqPlanLeadRefs(plan.file, plan.text)
    if (refs.length === 0) {
      throw new Error(`Plan ${plan.file} has no «Lead chat:» line.`)
    }
    const lead = resolve(plan, refs[0].current, open)
    if (!lead) {
      throw new Error(
        `The «Lead chat:» line of ${plan.file} names no chat Orca+ knows; write the Lead's sessionId there.`
      )
    }
    return lead
  }

  return async (ask) => {
    const plans = await deps.plans()
    const open = deps.openTabs?.() ?? null
    if (ask.plan) {
      const wanted = planName(ask.plan)
      const plan = plans.find((candidate) => candidate.file === wanted)
      if (!plan) {
        throw new Error(`No plan ${wanted} in HQ/runs.`)
      }
      return leadOfPlan(plan, open)
    }
    if (!ask.sessionId) {
      throw new Error(
        'This shell has no chat session: run it inside a chat, or pass --plan <file>.'
      )
    }
    const address = deps.getSession(ask.sessionId)?.address ?? null
    const tokens = [address, ask.sessionId, ask.sessionId.slice(0, SHORT_ID)].filter(
      (token): token is string => Boolean(token)
    )
    const leads: HqLeadResult[] = []
    for (const plan of plans) {
      const refs = hqPlanLeadRefs(plan.file, plan.text)
      // Why: a chat its Lead line names (now or «was») leads that plan; it is no worker there.
      const leadsIt = refs.some((ref) =>
        [...ref.current, ...ref.was].some((word) => tokens.includes(word))
      )
      if (refs.length === 0 || leadsIt || !tokens.some((token) => holds(plan.text, token))) {
        continue
      }
      const lead = resolve(plan, refs[0].current, open)
      if (lead && !leads.some((known) => known.sessionId === lead.sessionId)) {
        leads.push(lead)
      }
    }
    const shown = address ?? ask.sessionId
    if (leads.length === 0) {
      throw new Error(
        `No plan in HQ/runs names this chat (${shown}) under a Lead; pass --plan <file>, or send to the Lead's sessionId from its plan's «Lead chat:» line.`
      )
    }
    // Why: a chat named in an old plan too still reports to the plan whose Lead is open.
    const openLeads = leads.filter((lead) => lead.open !== false)
    const pick = openLeads.length > 0 ? openLeads : leads
    if (pick.length > 1) {
      throw new Error(
        `Plans of different Leads name this chat (${shown}): ${pick
          .map((lead) => `${lead.plan} → ${lead.address ?? lead.sessionId} (${lead.sessionId})`)
          .join('; ')}. Pass --plan <file>, or send to the Lead's sessionId.`
      )
    }
    return pick[0]
  }
}
