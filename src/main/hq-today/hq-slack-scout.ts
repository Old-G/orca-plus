// Custom build (hq-slack-scout): HQ's side of the Slack scout's files — the drafts it wrote, the
// owner's decisions on them, and the task a Create makes in ClickUp.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  HQ_SLACK_SCOUT_CONFIG_FILE,
  HQ_SLACK_SCOUT_DECISIONS_FILE,
  HQ_SLACK_SCOUT_DIR,
  HQ_SLACK_SCOUT_DRAFTS_FILE,
  HQ_SLACK_SCOUT_STATUS_FILE,
  parseHqSlackScoutDecisions,
  parseHqSlackScoutFailedAt,
  parseHqSlackScoutDrafts,
  parseHqSlackScoutTaskTarget,
  pendingHqSlackScoutDrafts,
  type HqSlackScoutCreateResult,
  type HqSlackScoutDecision,
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

export async function readHqSlackScout(hqPath: string): Promise<HqSlackScoutResult> {
  try {
    const [config, drafts, decisions, status] = await Promise.all([
      readOptional(scoutPath(hqPath, HQ_SLACK_SCOUT_CONFIG_FILE)),
      readOptional(scoutPath(hqPath, HQ_SLACK_SCOUT_DRAFTS_FILE)),
      readOptional(scoutPath(hqPath, HQ_SLACK_SCOUT_DECISIONS_FILE)),
      readOptional(scoutPath(hqPath, HQ_SLACK_SCOUT_STATUS_FILE))
    ])
    const file = parseHqSlackScoutDrafts(drafts ?? '{}')
    return {
      ok: true,
      configured: config !== null,
      lastRunAt: file.lastRunAt,
      failedAt: parseHqSlackScoutFailedAt(status),
      drafts: pendingHqSlackScoutDrafts(file.drafts, parseHqSlackScoutDecisions(decisions ?? '{}'))
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

// Why one chain: Create and Reject on two drafts at once must not drop each other's decision.
let decisionWrites: Promise<unknown> = Promise.resolve()

function recordDecision(
  hqPath: string,
  draftId: string,
  decision: HqSlackScoutDecision
): Promise<void> {
  const write = decisionWrites.then(async () => {
    const path = scoutPath(hqPath, HQ_SLACK_SCOUT_DECISIONS_FILE)
    const current = parseHqSlackScoutDecisions((await readOptional(path)) ?? '{}')
    await mkdir(join(hqPath, HQ_SLACK_SCOUT_DIR), { recursive: true })
    const temp = `${path}.${process.pid}.tmp`
    await writeFile(temp, `${JSON.stringify({ ...current, [draftId]: decision }, null, 2)}\n`)
    await rename(temp, path)
  })
  decisionWrites = write.catch(() => undefined)
  return write
}

export async function rejectHqSlackScoutDraft(
  hqPath: string,
  draftId: string,
  deps: HqSlackScoutDeps = defaultDeps
): Promise<void> {
  await recordDecision(hqPath, draftId, { decision: 'rejected', at: deps.now() })
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
  return { ok: true, taskUrl: created.url }
}
