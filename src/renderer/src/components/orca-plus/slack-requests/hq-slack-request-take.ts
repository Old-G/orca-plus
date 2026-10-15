// Custom build (hq-slack-requests): «Do» on a Slack request — the ClickUp task, then Claude in the
// request's project the way «Take» starts one (task moved to «in process», remembered for closing),
// told to answer in the thread through the Approve window and close the task once it is answered.
import type { ClickUpTask } from '../../../../../shared/clickup-types'
import type { HqAutonomyLevel } from '../../../../../shared/hq-autonomy'
import type { HqProjectPage } from '../../../../../shared/hq-project-pages'
import { hqSlackDoPromptTail, hqSlackThread } from '../../../../../shared/hq-slack-request-prompts'
import type {
  HqSlackScoutCreateResult,
  HqSlackScoutDraft
} from '../../../../../shared/hq-slack-scout'
import type { Repo } from '../../../../../shared/repo-types'
import type { HqTakenSession } from '../hq/hq-triage-decisions'
import {
  buildHqTriageWorkItem,
  takeHqTriageTask,
  type HqTriageTakeDeps,
  type HqTriageTakeResult
} from '../hq/hq-triage-take'
import type { LaunchableWorkItem } from '@/lib/launch-work-item-direct-types'

const DEFAULT_LEVEL: HqAutonomyLevel = 1

export type HqSlackTakeDeps = Omit<HqTriageTakeDeps, 'launch' | 'remember'> & {
  listPages: () => Promise<HqProjectPage[]>
  repos: () => readonly Repo[]
  createTask: (draft: {
    id: string
    title: string
    description: string
  }) => Promise<HqSlackScoutCreateResult>
  launchInRepo: (
    item: LaunchableWorkItem,
    repo: Repo
  ) => Promise<{ launched: boolean; session: HqTakenSession | null }>
  remember: (taskId: string, repoId: string, session: HqTakenSession | null) => Promise<unknown>
  now: () => Date
}

export type HqSlackTakeOutcome =
  /** The request names no project; the owner picks one first. */
  | { kind: 'needs-project' }
  | { kind: 'no-repo'; project: string }
  | { kind: 'create-failed'; error: string }
  /** The task exists but no agent started: ClickUp did not return it, or the launch failed. */
  | { kind: 'created-only'; taskUrl: string }
  | { kind: 'taken'; taskUrl: string; identifier: string; take: HqTriageTakeResult }

export async function takeHqSlackRequest(
  draft: Pick<HqSlackScoutDraft, 'id' | 'title' | 'description' | 'project' | 'permalink'>,
  deps: HqSlackTakeDeps
): Promise<HqSlackTakeOutcome> {
  if (!draft.project) {
    return { kind: 'needs-project' }
  }
  const page = (await deps.listPages().catch(() => [])).find((p) => p.slug === draft.project)
  const repo = page ? deps.repos().find((candidate) => candidate.id === page.repoId) : undefined
  if (!page || !repo) {
    return { kind: 'no-repo', project: draft.project }
  }
  const startedAt = deps.now().toISOString()
  const created = await deps
    .createTask({ id: draft.id, title: draft.title.trim(), description: draft.description })
    .catch((error: unknown) => ({ ok: false as const, error: String(error) }))
  if (!created.ok) {
    return { kind: 'create-failed', error: created.error }
  }
  const taskId = created.taskId
  const full: ClickUpTask | null = taskId ? await deps.getTask(taskId).catch(() => null) : null
  if (!taskId || !full) {
    return { kind: 'created-only', taskUrl: created.taskUrl }
  }
  const thread = hqSlackThread(draft)
  let session: HqTakenSession | null = null
  const take = await takeHqTriageTask(
    full,
    (loaded) =>
      buildHqTriageWorkItem(
        full,
        loaded,
        { name: repo.displayName, level: page.autonomy ?? DEFAULT_LEVEL },
        thread ? hqSlackDoPromptTail(thread, startedAt) : undefined
      ),
    {
      getTask: deps.getTask,
      listStatuses: deps.listStatuses,
      setStatus: deps.setStatus,
      launch: async (item) => {
        const launched = await deps.launchInRepo(item, repo)
        session = launched.session
        return launched.launched
      },
      remember: () => deps.remember(taskId, repo.id, session)
    }
  )
  return take.launched
    ? { kind: 'taken', taskUrl: created.taskUrl, identifier: full.identifier, take }
    : { kind: 'created-only', taskUrl: created.taskUrl }
}
