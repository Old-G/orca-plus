// Custom build (hq-lead-reassign, owner 16.11): a Lead's plan file names its Lead in a line
// `Lead chat: <address> (<sessionId>) · started … · …` (`Sub-lead chat:` for a sub-lead). Workers read
// the Lead's address there before each report, and the lead-guard hook finds the Lead by it, so a lead
// change rewrites that line: the new Lead's address and session, the old one kept as «(was: …)».
import { readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const LEAD_LINE = /^([\s*_>#-]*(?:sub-?lead|lead) chat:\s*)(.*)$/i
// Why: «(was: <old lead>)» (or its Russian word) names a Lead the plan had before; the hook skips it too.
const WAS =
  /\(\s*(?:\u0431\u044b\u043b[\u0430\u0438]?|was|\u043f\u0440\u0435\u0436\u043d\u0438\u0439|old)(?![\p{L}\p{N}_])[^)]*\)/giu
const SEPARATOR = ' · '

export type HqPlanLead = {
  /** The Lead's thread address and every session it had on it. */
  address: string | null
  sessionIds: readonly string[]
}

function names(head: string, lead: HqPlanLead): boolean {
  const bare = head.replace(WAS, ' ').replace(/`/g, ' ')
  const words = new Set(bare.split(/[\s(),;]+/).filter(Boolean))
  return (
    (lead.address !== null && words.has(lead.address)) ||
    lead.sessionIds.some((id) => words.has(id))
  )
}

function stamp(at: number): string {
  const date = new Date(at)
  return `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}`
}

/** One plan's `Lead chat:` line: who leads it now, and who it names as the Lead before. */
export type HqPlanLeadRef = {
  file: string
  current: readonly string[]
  was: readonly string[]
  /** The plan's first lines: a launched successor's plan tells who the old Lead was. */
  text: string
}

function wordsOf(text: string): string[] {
  return text
    .replace(/`/g, ' ')
    .split(/[\s(),;]+/)
    .filter(Boolean)
}

/** Custom build (hq-lead-handover, T2): the Lead lines of a plan text (not `Sub-lead chat:`), each split
 *  into its current Lead's words (address, session id) and the «(was: …)» words. */
export function hqPlanLeadRefs(file: string, text: string): HqPlanLeadRef[] {
  const refs: HqPlanLeadRef[] = []
  for (const line of text.split('\n')) {
    const match = LEAD_LINE.exec(line)
    if (!match || /sub-?lead/i.test(match[1])) {
      continue
    }
    const cut = match[2].indexOf(SEPARATOR)
    const head = cut === -1 ? match[2] : match[2].slice(0, cut)
    const was = [...head.matchAll(WAS)].flatMap((found) =>
      wordsOf(found[0].replace(/^\(\s*\S+/, ''))
    )
    refs.push({ file, current: wordsOf(head.replace(WAS, ' ')), was, text })
  }
  return refs
}

// Why: the Lead line sits in the plan's first lines; the sweep reads this every two minutes.
const PLAN_HEAD_CHARS = 6_000

/** The Lead lines of every plan in `<hq>/runs`. */
export async function hqReadPlanLeadRefs(hqPath: string): Promise<HqPlanLeadRef[]> {
  const runs = join(hqPath, 'runs')
  // Why throws: a plan not read could be the one that still names the old Lead; the sweep then decides nothing.
  const names = await readdir(runs)
  const refs: HqPlanLeadRef[] = []
  for (const name of names.filter((entry) => entry.endsWith('.md')).sort()) {
    const text = await readFile(join(runs, name), 'utf8')
    refs.push(...hqPlanLeadRefs(name, text.slice(0, PLAN_HEAD_CHARS)))
  }
  return refs
}

/** The plan text with each Lead line naming `from` rewritten to `to`; null when none names it. */
export function hqRewriteLeadLines(
  text: string,
  from: HqPlanLead,
  to: { address: string | null; sessionId: string },
  at: number
): string | null {
  let changed = false
  const lines = text.split('\n').map((line) => {
    const match = LEAD_LINE.exec(line)
    if (!match) {
      return line
    }
    const body = match[2]
    const cut = body.indexOf(SEPARATOR)
    const head = cut === -1 ? body : body.slice(0, cut)
    if (!names(head, from)) {
      return line
    }
    changed = true
    const now = to.address ? `\`${to.address}\` (${to.sessionId})` : to.sessionId
    const was = from.address ?? from.sessionIds[0] ?? ''
    const rest = cut === -1 ? '' : body.slice(cut)
    return `${match[1]}${now} (was: \`${was}\`, ${stamp(at)})${rest}`
  })
  return changed ? lines.join('\n') : null
}

/** Rewrites the Lead line in every plan of `<hq>/runs` that names `from` — only in `only` (file names or
 *  paths) when given; returns the files changed. */
export async function hqRewritePlanLeads(
  hqPath: string,
  from: HqPlanLead,
  to: { address: string | null; sessionId: string },
  at: number,
  dryRun: boolean,
  only?: readonly string[]
): Promise<string[]> {
  const runs = join(hqPath, 'runs')
  const names = await readdir(runs).catch(() => [] as string[])
  const changed: string[] = []
  for (const name of names.filter((entry) => entry.endsWith('.md')).sort()) {
    const path = join(runs, name)
    // Why matched against the listing: a name from the command line never reaches past HQ/runs.
    if (only && !only.some((wanted) => wanted === name || wanted === path)) {
      continue
    }
    const text = await readFile(path, 'utf8').catch(() => null)
    const next = text === null ? null : hqRewriteLeadLines(text, from, to, at)
    if (next === null) {
      continue
    }
    if (!dryRun) {
      // Why: written aside and renamed, so a Lead reading its plan never sees half a file.
      await writeFile(`${path}.tmp`, next)
      await rename(`${path}.tmp`, path)
    }
    changed.push(path)
  }
  return changed
}
