// Custom build (hq-slack-scout): HQ's side of the Slack scout's files — the drafts it wrote, the
// owner's decisions on them and corrections to them, and the task a Create makes in ClickUp.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  HQ_CLICKUP_REQUESTS_FILE,
  HQ_SLACK_SCOUT_CONFIG_FILE,
  HQ_SLACK_SCOUT_DECISIONS_FILE,
  HQ_SLACK_SCOUT_DIR,
  HQ_SLACK_SCOUT_DRAFTS_FILE,
  HQ_SLACK_SCOUT_EDITS_FILE,
  HQ_SLACK_SCOUT_STATUS_FILE,
  applyHqSlackScoutEdits,
  parseHqSlackScoutDecisions,
  parseHqSlackScoutEdits,
  parseHqSlackScoutFailedAt,
  parseHqSlackScoutDrafts,
  parseHqSlackScoutTaskTarget,
  hqSlackScoutDone,
  pendingHqSlackScoutDrafts,
  freshHqSlackScoutDraft,
  parseHqSlackScoutTuning,
  type HqSlackScoutCreateResult,
  type HqSlackScoutDecision,
  type HqSlackScoutEdit,
  type HqSlackScoutResult
} from '../../shared/hq-slack-scout'
import { createClickUpTask } from '../clickup/clickup-tasks'

export type HqSlackScoutDeps = {
  createTask: typeof createClickUpTask
  now: () => number
}

const defaultDeps: HqSlackScoutDeps = { createTask: createClickUpTask, now: Date.now }

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (error instanceof Error && Reflect.get(error, 'code') === 'ENOENT') {
      return null
    }
    throw error
  }
}

function scoutPath(hqPath: string, file: string): string {
  return join(hqPath, HQ_SLACK_SCOUT_DIR, file)
}

/** Every request in the scout's files and Orca+'s own, with the owner's corrections over them. */
async function readScoutFiles(hqPath: string) {
  const [config, drafts, decisions, status, edits, clickup] = await Promise.all([
    readOptional(scoutPath(hqPath, HQ_SLACK_SCOUT_CONFIG_FILE)),
    readOptional(scoutPath(hqPath, HQ_SLACK_SCOUT_DRAFTS_FILE)),
    readOptional(scoutPath(hqPath, HQ_SLACK_SCOUT_DECISIONS_FILE)),
    readOptional(scoutPath(hqPath, HQ_SLACK_SCOUT_STATUS_FILE)),
    readOptional(scoutPath(hqPath, HQ_SLACK_SCOUT_EDITS_FILE)),
    readOptional(scoutPath(hqPath, HQ_CLICKUP_REQUESTS_FILE))
  ])
  const file = parseHqSlackScoutDrafts(drafts ?? '{}')
  // Custom build (hq-clickup-requests): comments on the owner's tasks sit beside the Slack requests.
  // Why: only Orca+'s own clickup.json may name a ClickUp task to comment on or take; the scout
  // writes drafts.json from Slack text other people control.
  const slackDrafts = file.drafts.map(
    ({ source: _source, clickupTaskId: _taskId, ...draft }) => draft
  )
  const clickupDrafts = parseHqSlackScoutDrafts(clickup ?? '{}').drafts.flatMap((draft) =>
    draft.clickupTaskId ? [{ ...draft, source: 'clickup' as const }] : []
  )
  return {
    tuning: parseHqSlackScoutTuning(config ?? ''),
    configured: config !== null || clickupDrafts.length > 0,
    lastRunAt: file.lastRunAt,
    failedAt: parseHqSlackScoutFailedAt(status),
    all: applyHqSlackScoutEdits(
      [...slackDrafts, ...clickupDrafts],
      parseHqSlackScoutEdits(edits ?? '{}')
    ),
    decisions: parseHqSlackScoutDecisions(decisions ?? '{}')
  }
}

export async function readHqSlackScout(
  hqPath: string,
  now: () => number = Date.now
): Promise<HqSlackScoutResult> {
  try {
    const { all, decisions, tuning, ...run } = await readScoutFiles(hqPath)
    const at = now()
    return {
      ok: true,
      ...run,
      // Custom build (hq-scout-quiet): a request nobody decided for days has gone quiet.
      drafts: pendingHqSlackScoutDrafts(all, decisions).filter((draft) =>
        freshHqSlackScoutDraft(draft, tuning, at)
      ),
      done: hqSlackScoutDone(decisions, at)
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

const changeListeners = new Set<() => void>()

/** Custom build (hq-slack-requests): fires after HQ records a decision or a correction. */
export function onHqSlackScoutChanged(listener: () => void): () => void {
  changeListeners.add(listener)
  return () => changeListeners.delete(listener)
}

/** Custom build (hq-clickup-requests): tells listeners Orca+ wrote requests of its own. */
export function notifyHqSlackScoutChanged(): void {
  for (const listener of changeListeners) {
    listener()
  }
}

// Why one chain: two decisions at once must not drop each other's entry.
let recordWrites: Promise<unknown> = Promise.resolve()

function writeRecordEntry<T>(
  hqPath: string,
  file: string,
  parse: (text: string) => Record<string, T>,
  draftId: string,
  /** undefined drops the entry. */
  update: (current: T | undefined) => T | undefined
): Promise<void> {
  const write = recordWrites.then(async () => {
    const path = scoutPath(hqPath, file)
    const current = parse((await readOptional(path)) ?? '{}')
    await mkdir(join(hqPath, HQ_SLACK_SCOUT_DIR), { recursive: true })
    const temp = `${path}.${process.pid}.tmp`
    const { [draftId]: previous, ...rest } = current
    const value = update(previous)
    const next = value === undefined ? rest : { ...rest, [draftId]: value }
    await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`)
    await rename(temp, path)
  })
  recordWrites = write.catch(() => undefined)
  return write.then(() => {
    for (const listener of changeListeners) {
      listener()
    }
  })
}

async function recordDecision(
  hqPath: string,
  draftId: string,
  decided: HqSlackScoutDecision
): Promise<void> {
  // Custom build (hq-done-journal): the journal names the request after its draft is gone.
  const draft = (await readScoutFiles(hqPath).catch(() => null))?.all.find((d) => d.id === draftId)
  const decision: HqSlackScoutDecision = draft
    ? {
        ...decided,
        title: (draft.ask || draft.title).slice(0, 300),
        ...(draft.author ? { author: draft.author.slice(0, 200) } : {}),
        source: draft.source ?? 'slack',
        permalink: draft.permalink.slice(0, 2000)
      }
    : decided
  return writeRecordEntry(
    hqPath,
    HQ_SLACK_SCOUT_DECISIONS_FILE,
    parseHqSlackScoutDecisions,
    draftId,
    () => decision
  )
}

/** Custom build (hq-slack-requests): the owner's correction, merged over earlier ones. */
export async function editHqSlackScoutDraft(
  hqPath: string,
  draftId: string,
  edit: HqSlackScoutEdit
): Promise<void> {
  await writeRecordEntry(
    hqPath,
    HQ_SLACK_SCOUT_EDITS_FILE,
    parseHqSlackScoutEdits,
    draftId,
    (current) => ({ ...current, ...edit })
  )
}

/** Custom build (hq-clickup-requests): the owner took the existing ClickUp task the request is on. */
export async function takeHqSlackScoutDraft(
  hqPath: string,
  draftId: string,
  deps: HqSlackScoutDeps = defaultDeps
): Promise<void> {
  await recordDecision(hqPath, draftId, { decision: 'taken', at: deps.now() })
}

/** Custom build (hq-slack-requests): the owner answers in the thread himself; no task. */
export async function answerHqSlackScoutDraft(
  hqPath: string,
  draftId: string,
  deps: HqSlackScoutDeps = defaultDeps
): Promise<void> {
  await recordDecision(hqPath, draftId, { decision: 'answered', at: deps.now() })
}

export async function rejectHqSlackScoutDraft(
  hqPath: string,
  draftId: string,
  deps: HqSlackScoutDeps = defaultDeps
): Promise<void> {
  await recordDecision(hqPath, draftId, { decision: 'rejected', at: deps.now() })
}

/** Custom build (hq-done-journal): a skipped request comes back while its draft is still on file. */
export async function restoreHqSlackScoutDraft(hqPath: string, draftId: string): Promise<void> {
  const { all, decisions } = await readScoutFiles(hqPath)
  if (decisions[draftId]?.decision !== 'rejected' || !all.some((draft) => draft.id === draftId)) {
    throw new Error('This request can no longer come back.')
  }
  await writeRecordEntry<HqSlackScoutDecision>(
    hqPath,
    HQ_SLACK_SCOUT_DECISIONS_FILE,
    parseHqSlackScoutDecisions,
    draftId,
    () => undefined
  )
}

/** Creates the owner-edited draft as a task where config.yaml says, then marks the draft created. */
export async function createHqSlackScoutTask(
  hqPath: string,
  draft: { id: string; title: string; description: string },
  deps: HqSlackScoutDeps = defaultDeps
): Promise<HqSlackScoutCreateResult> {
  const target = parseHqSlackScoutTaskTarget(
    (await readOptional(scoutPath(hqPath, HQ_SLACK_SCOUT_CONFIG_FILE))) ?? ''
  )
  if (!target) {
    return {
      ok: false,
      error: `No list_id in ${HQ_SLACK_SCOUT_DIR}/${HQ_SLACK_SCOUT_CONFIG_FILE}.`
    }
  }
  const created = await deps.createTask({
    listId: target.listId,
    name: draft.title,
    markdownDescription: draft.description,
    assigneeId: target.assigneeId,
    status: target.status
  })
  if (!created.ok) {
    return created
  }
  await recordDecision(hqPath, draft.id, {
    decision: 'created',
    at: deps.now(),
    taskUrl: created.url
  })
  return { ok: true, taskUrl: created.url, ...(created.id ? { taskId: created.id } : {}) }
}
