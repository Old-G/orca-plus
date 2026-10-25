// Custom build (hq-plus-routing): carries out HQ/routing.yaml. For the evening Codex review it opens
// one «Codex: починить» chat per project in a fresh worktree, hands it the findings, and gives the
// findings that chat's thread address — so a finding with an address is taken, one without is not.
import { join } from 'node:path'
import { HQ_AUTONOMY_FILE, parseHqAutonomy } from '../../shared/hq-autonomy'
import {
  HQ_JOURNAL_KIND,
  HQ_JOURNAL_MAX_LIMIT,
  type HqJournalEntry,
  type HqJournalInput
} from '../../shared/hq-journal'
import {
  HQ_ROUTING_FILE,
  HQ_ROUTING_KIND,
  HQ_ROUTING_SOURCE,
  type HqRouteAction,
  type HqRouteResult
} from '../../shared/hq-routing'
import { journalEntryAsInput } from '../hq-journal/hq-journal-adapters'
import type { HqJournalPulse } from '../hq-journal/hq-journal-collect'
import type { HqBackgroundChatLaunch } from '../hq-today/hq-background-chat'
import {
  hqCodexFixFollowUp,
  hqCodexFixPrompt,
  hqLocalDay,
  hqReviewedCommits,
  hqStartOfDay,
  planHqCodexFix,
  planHqReportFix
} from './hq-routing-codex-fix'
import { parseHqRouting } from './hq-routing-rules'

// Why: a launch that failed is tried again within the evening, not every five minutes.
const RETRY_AFTER_MS = 60 * 60_000
export const HQ_CODEX_FIX_CHAT_NAME = 'Codex: починить'

export type HqRoutingDeps = {
  enabled: () => boolean
  hqPath: () => string | null
  readText: (path: string) => Promise<string | null>
  pulse: Pick<HqJournalPulse, 'list' | 'record' | 'noteSessions'>
  /** The project's repo in Orca; null when none is open. */
  workspaceFor: (
    project: string
  ) => Promise<{ repoId: string; repoPath: string; name: string } | null>
  /** The branch holding the newest of these commits; null leaves the repo's default. */
  baseBranch: (repoPath: string, commits: readonly string[]) => Promise<string | null>
  launch: (target: {
    repoId: string
    name: string
    baseBranch?: string
  }) => Promise<HqBackgroundChatLaunch>
  limit: (sessionId: string) => Promise<boolean>
  nameChat: (sessionId: string, name: string) => Promise<void>
  deliver: (sessionId: string, prompt: string) => Promise<boolean>
  freePercent: () => number | null
  now: () => number
  log: (message: string) => void
}

export type HqRouteOptions = {
  dryRun?: boolean
  manual?: boolean
  since?: number
  /** Custom build (hq-fix-now-all): «Fix now» on this report (`updates/codex-review-….md`) — all its findings. */
  report?: string
}

export type HqRoutingService = {
  run: (options?: HqRouteOptions) => Promise<HqRouteResult>
}

export function createHqRouting(deps: HqRoutingDeps): HqRoutingService {
  const failedAt = new Map<string, number>()
  let running: Promise<HqRouteResult> | null = null

  const actionRow = (
    action: HqRouteAction,
    title: string,
    needs: string,
    dedupeKey: string | null
  ): HqJournalInput => ({
    workspace: action.workspace,
    kind: HQ_ROUTING_KIND.action,
    project: action.project,
    address: action.address,
    sessionId: action.sessionId,
    personId: null,
    title,
    body: action.findings.join('\n'),
    needs,
    status: needs === 'nobody' ? 'done' : 'open',
    replyTo: null,
    refKind: action.sessionId ? 'session' : null,
    refId: action.sessionId,
    source: HQ_ROUTING_SOURCE,
    dedupeKey
  })

  /** The fixing chat each project got today, from the journal itself. */
  const todaysChats = (now: number): Map<string, { sessionId: string; address: string }> => {
    const today = new Map<string, { sessionId: string; address: string }>()
    for (const row of deps.pulse.list({
      kind: HQ_ROUTING_KIND.action,
      source: HQ_ROUTING_SOURCE,
      since: hqStartOfDay(now),
      oldestFirst: true,
      limit: HQ_JOURNAL_MAX_LIMIT
    })) {
      if (row.project && row.sessionId && row.address) {
        today.set(row.project, { sessionId: row.sessionId, address: row.address })
      }
    }
    return today
  }

  const commitsOf = async (hqPath: string, findings: HqJournalEntry[]): Promise<string[]> => {
    const file = findings.find((finding) => finding.refKind === 'file')?.refId
    const report = file ? await deps.readText(join(hqPath, file)) : null
    return report
      ? hqReviewedCommits(
          report,
          findings.map((finding) => finding.title)
        )
      : []
  }

  const take = (findings: HqJournalEntry[], address: string): void => {
    deps.pulse.record(findings.map((finding) => journalEntryAsInput(finding, { address })))
  }

  const carryOut = async (
    hqPath: string,
    action: HqRouteAction,
    findings: HqJournalEntry[],
    now: number,
    manual: boolean
  ): Promise<HqRouteAction> => {
    const count = `${findings.length} ${findings.length === 1 ? 'finding' : 'findings'}`
    if (action.kind === 'suggest') {
      deps.pulse.record([
        actionRow(
          action,
          `Codex: ${count} in ${action.project}; autonomy 0 — open a fixing chat?`,
          'owner:decide',
          `routing:codex-suggest:${action.project}:${hqLocalDay(now)}`
        )
      ])
      return action
    }
    if (action.kind === 'wait') {
      return action
    }
    const commits = await commitsOf(hqPath, findings)
    if (action.kind === 'continue' && action.sessionId && action.address) {
      if (await deps.deliver(action.sessionId, hqCodexFixFollowUp({ findings, commits }))) {
        take(findings, action.address)
        deps.pulse.record([
          actionRow(action, `Codex: ${count} more handed to ${action.address}`, 'nobody', null)
        ])
        return action
      }
      deps.log(
        `routing: the chat on ${action.address} did not take more findings; opening a new one`
      )
    }
    const retryAt = (failedAt.get(action.project) ?? 0) + RETRY_AFTER_MS
    if (!manual && now < retryAt) {
      return {
        ...action,
        kind: 'wait',
        note: 'the last launch failed; tried again within the hour'
      }
    }
    const fail = (error: string): HqRouteAction => {
      failedAt.set(action.project, now)
      deps.log(`routing: no fixing chat for ${action.project}: ${error}`)
      deps.pulse.record([
        actionRow(
          { ...action, address: null, sessionId: null },
          `Codex: ${count} in ${action.project} — the fixing chat did not start: ${error}`,
          'owner:decide',
          `routing:codex-fix-failed:${action.project}:${hqLocalDay(now)}`
        )
      ])
      return { ...action, note: error }
    }
    const workspace = await deps.workspaceFor(action.project)
    if (!workspace) {
      return fail(`project ${action.project} is not open in Orca`)
    }
    const baseBranch = await deps.baseBranch(workspace.repoPath, commits)
    const stamp = new Date(now)
    const minute = `${String(stamp.getHours()).padStart(2, '0')}${String(stamp.getMinutes()).padStart(2, '0')}`
    const launched = await deps.launch({
      repoId: workspace.repoId,
      name: `codex-fix-${hqLocalDay(now)}-${minute}`,
      ...(baseBranch ? { baseBranch } : {})
    })
    if (!launched.ok) {
      return fail(launched.error)
    }
    // Why: the findings quote code and commit text; full access would let them steer the chat.
    if (!(await deps.limit(launched.sessionId))) {
      return fail('the chat could not be switched to Auto')
    }
    await deps.nameChat(launched.sessionId, `${HQ_CODEX_FIX_CHAT_NAME} · ${workspace.name}`)
    const address = action.address ?? ''
    const prompt = hqCodexFixPrompt({
      projectName: workspace.name,
      project: action.project,
      address,
      level: action.level ?? 1,
      findings,
      commits
    })
    if (!(await deps.deliver(launched.sessionId, prompt))) {
      return fail('the chat did not take the findings')
    }
    deps.pulse.noteSessions([
      {
        sessionId: launched.sessionId,
        address,
        agent: 'claude',
        worktreeId: launched.worktreeId,
        workspace: action.workspace,
        project: action.project,
        state: 'working',
        contextPct: null,
        parentSessionId: null,
        taskRef: null,
        at: now
      }
    ])
    take(findings, address)
    const opened = { ...action, sessionId: launched.sessionId }
    deps.pulse.record([
      actionRow(
        opened,
        `${HQ_CODEX_FIX_CHAT_NAME} · ${workspace.name}: ${count}${baseBranch ? ` from ${baseBranch}` : ''}`,
        'nobody',
        `routing:codex-fix:${launched.sessionId}`
      )
    ])
    failedAt.delete(action.project)
    return opened
  }

  const carryAll = async (
    hqPath: string,
    actions: HqRouteAction[],
    rows: readonly HqJournalEntry[],
    now: number,
    manual: boolean
  ): Promise<HqRouteAction[]> => {
    const byId = new Map(rows.map((finding) => [finding.id, finding]))
    const done: HqRouteAction[] = []
    for (const action of actions) {
      if (action.kind === 'open' && action.note) {
        deps.log(`routing: ${action.project}: ${action.note}`)
      }
      const findings = action.findings.flatMap((id) => byId.get(id) ?? [])
      done.push(
        await carryOut(hqPath, action, findings, now, manual).catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error)
          deps.log(`routing: ${action.project} failed: ${message}`)
          return { ...action, note: message }
        })
      )
    }
    return done
  }

  // Custom build (hq-fix-now-all): the owner pressed «Fix now» on a report — all of it, now.
  const runReport = async (
    hqPath: string,
    report: string,
    dryRun: boolean
  ): Promise<HqRouteResult> => {
    const now = deps.now()
    const autonomy = parseHqAutonomy(await deps.readText(join(hqPath, HQ_AUTONOMY_FILE)))
    const rows = deps.pulse
      .list({ kind: HQ_JOURNAL_KIND.reviewFinding, limit: HQ_JOURNAL_MAX_LIMIT })
      .filter((row) => row.refId === report)
      .toReversed()
    const ids = new Set(rows.map((row) => row.id))
    const settled = new Map<string, string | null>()
    for (const row of deps.pulse.list({
      kind: HQ_ROUTING_KIND.settled,
      limit: HQ_JOURNAL_MAX_LIMIT
    })) {
      if (row.refId && ids.has(row.refId) && !settled.has(row.refId)) {
        settled.set(row.refId, row.links.find((link) => link.kind === 'commit')?.id ?? null)
      }
    }
    const { actions, handled } = planHqReportFix({
      now,
      findings: rows,
      autonomy,
      today: todaysChats(now),
      settled
    })
    if (dryRun) {
      return { dryRun, actions, handled, problems: [] }
    }
    return {
      dryRun,
      actions: await carryAll(hqPath, actions, rows, now, true),
      handled,
      problems: []
    }
  }

  const runOnce = async (options: HqRouteOptions): Promise<HqRouteResult> => {
    const dryRun = options.dryRun === true
    const hqPath = deps.hqPath()
    if (!hqPath) {
      return { dryRun, actions: [], problems: ['No HQ folder is set.'] }
    }
    if (!deps.enabled()) {
      return { dryRun, actions: [], problems: ['The HQ+ journal is off.'] }
    }
    if (options.report) {
      return runReport(hqPath, options.report, dryRun)
    }
    const routing = parseHqRouting(await deps.readText(join(hqPath, HQ_ROUTING_FILE)))
    if (routing.findings.length === 0) {
      return { dryRun, actions: [], problems: routing.problems }
    }
    const autonomy = parseHqAutonomy(await deps.readText(join(hqPath, HQ_AUTONOMY_FILE)))
    const now = deps.now()
    const open = deps.pulse.list({
      kind: HQ_JOURNAL_KIND.reviewFinding,
      needs: 'agent:new',
      status: 'open',
      limit: HQ_JOURNAL_MAX_LIMIT,
      oldestFirst: true
    })
    const actions = planHqCodexFix({
      routing,
      now,
      findings: open,
      autonomy,
      today: todaysChats(now),
      freePercent: deps.freePercent(),
      manual: options.manual === true,
      since: options.since
    })
    if (dryRun) {
      return { dryRun, actions, problems: routing.problems }
    }
    const done = await carryAll(hqPath, actions, open, now, options.manual === true)
    return { dryRun, actions: done, problems: routing.problems }
  }

  const run = (options: HqRouteOptions = {}): Promise<HqRouteResult> => {
    // Why: the timer and a manual run must not open two chats for one project.
    if (!running) {
      running = runOnce(options).finally(() => {
        running = null
      })
      return running
    }
    if (options.dryRun) {
      return runOnce(options)
    }
    // Why: «Fix now» answers about its own report, not with the timer's result.
    return options.report ? running.then(() => run(options)) : running
  }

  return { run }
}

let provided: HqRoutingService | null = null

export function provideHqRouting(service: HqRoutingService | null): void {
  provided = service
}

export function getHqRouting(): HqRoutingService | null {
  return provided
}
