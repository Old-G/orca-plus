// Custom build (hq-slack-requests): what the four answers to a Slack request do — the same from HQ's
// card, the bell and the toast. Each records the owner's decision, so the scout never brings it back.
import { useSyncExternalStore } from 'react'
import { toast } from 'sonner'
import type { HqSlackScoutDraft } from '../../../../../shared/hq-slack-scout'
import { HQ_SLACK_REQUEST_ACTION } from '../../../../../shared/hq-slack-request-bell'
import { hqSlackReplyPrompt, hqSlackThread } from '../../../../../shared/hq-slack-request-prompts'
import { withHqTakeEffort } from '../../../../../shared/hq-triage'
import { isGitRepoKind } from '../../../../../shared/repo-kind'
import { translate } from '@/i18n/i18n'
import {
  clickUpGetTask,
  clickUpListStatuses,
  clickUpUpdateTaskStatus
} from '@/runtime/runtime-clickup-client'
import { useAppStore } from '@/store'
import { findHqWorktreeId, launchHqCommand } from '../hq/hq-today-actions'
import { launchHqTakeInRepo } from '../hq/hq-take-launch'
import { rememberHqTake } from '../hq/hq-triage-decisions'
import { openHqScreen } from '../hq/hq-view'
import { readHqClickUpSourceContext } from '../hq/use-hq-project-clickup'
import { takeHqSlackRequest, type HqSlackTakeDeps } from './hq-slack-request-take'

type Written = { ok: true } | { ok: false; error: string }

async function findDraft(id: string): Promise<HqSlackScoutDraft | null> {
  const result = await window.api.hqProjects.slackDrafts()
  return result.ok ? (result.drafts.find((draft) => draft.id === id) ?? null) : null
}

function settle(result: Written): boolean {
  if (!result.ok) {
    toast.error(result.error)
  }
  return result.ok
}

const failed = (error: unknown): { ok: false; error: string } => ({
  ok: false,
  error: String(error)
})

// Why: the same ClickUp context HQ's «New tasks» uses, so a taken Slack task closes the same way.
const HQ_TODAY_SOURCE_PROJECT = 'hq-today'

function slackTakeDeps(): HqSlackTakeDeps {
  const sourceContext = readHqClickUpSourceContext(HQ_TODAY_SOURCE_PROJECT)
  return {
    listPages: async () => {
      const result = await window.api.hqProjects.list()
      return result.ok ? result.pages : []
    },
    repos: () => (useAppStore.getState().repos ?? []).filter(isGitRepoKind),
    createTask: (draft) => window.api.hqProjects.createSlackDraftTask(draft),
    getTask: (taskId) => clickUpGetTask(sourceContext, taskId),
    listStatuses: (listId) => clickUpListStatuses(sourceContext, listId),
    setStatus: (taskId, status) => clickUpUpdateTaskStatus(sourceContext, taskId, status),
    launchInRepo: (item, repo) =>
      launchHqTakeInRepo({
        item,
        repoId: repo.id,
        sessionOptions: withHqTakeEffort(useAppStore.getState().settings?.nativeChatSessionOptions),
        openModalFallback: () =>
          useAppStore.getState().openModal('new-workspace-composer', {
            linkedWorkItem: item,
            initialRepoId: repo.id,
            telemetrySource: 'sidebar'
          })
      }),
    remember: rememberHqTake,
    now: () => new Date()
  }
}

function openTaskAction(taskUrl: string): { label: string; onClick: () => void } {
  return {
    label: translate('auto.hq.slack.open', 'Open'),
    onClick: () => void window.api.shell.openUrl(taskUrl)
  }
}

/** «Do»: the ClickUp task (with the owner's corrections), then Claude in the request's project. */
export async function doHqSlackRequest(
  draft: Pick<HqSlackScoutDraft, 'id' | 'title' | 'description' | 'project' | 'permalink'>
): Promise<boolean> {
  const outcome = await takeHqSlackRequest(draft, slackTakeDeps())
  switch (outcome.kind) {
    case 'needs-project':
      editHqSlackRequest(draft.id)
      toast.info(
        translate(
          'auto.hq.slack.pickProject',
          'Pick the project Claude should work in, save, then Do.'
        )
      )
      return false
    case 'no-repo':
      toast.error(
        translate('auto.hq.slack.noRepo', 'Project {{value0}} is not open in Orca as a git repo.', {
          value0: outcome.project
        })
      )
      return false
    case 'create-failed':
      toast.error(outcome.error)
      return false
    case 'created-only':
      toast.warning(
        translate(
          'auto.hq.slack.createdOnly',
          'Task created in ClickUp, but Claude did not start — take it from «New tasks».'
        ),
        { action: openTaskAction(outcome.taskUrl) }
      )
      return true
    case 'taken':
      toast.success(
        outcome.take.launched && outcome.take.status.kind !== 'set'
          ? translate(
              'auto.hq.slack.takenNoStatus',
              '{{value0}} created, Claude started; move it to «in process» by hand.',
              { value0: outcome.identifier }
            )
          : translate('auto.hq.slack.taken', '{{value0}} created, Claude started on it.', {
              value0: outcome.identifier
            }),
        { action: openTaskAction(outcome.taskUrl) }
      )
      return true
  }
}

/** «Just reply»: Claude in HQ drafts the owner's answer in the thread; it goes out only once approved.
 *  Without the HQ workspace the thread opens for the owner's own answer. */
export async function answerHqSlackRequest(
  draft: Pick<HqSlackScoutDraft, 'id' | 'permalink'>
): Promise<boolean> {
  const thread = hqSlackThread(draft)
  const state = useAppStore.getState()
  const hqWorktreeId = findHqWorktreeId(state.settings?.hqPath, state.repos, state.worktreesByRepo)
  if (thread && hqWorktreeId) {
    const launched = launchHqCommand(hqWorktreeId, hqSlackReplyPrompt(thread))
    if (!launched.ok) {
      toast.error(launched.message)
      return false
    }
    toast.success(
      translate(
        'auto.hq.slack.replyStarted',
        'Claude is drafting the reply; you approve it before it goes out.'
      )
    )
  } else if (draft.permalink) {
    void window.api.shell.openUrl(draft.permalink)
  }
  return settle(await window.api.hqProjects.answerSlackDraft({ id: draft.id }).catch(failed))
}

export async function skipHqSlackRequest(id: string): Promise<boolean> {
  return settle(await window.api.hqProjects.rejectSlackDraft({ id }).catch(failed))
}

let editTarget: string | null = null
const editListeners = new Set<() => void>()

function setEditTarget(id: string | null): void {
  editTarget = id
  for (const listener of editListeners) {
    listener()
  }
}

/** «Edit» from the bell or a toast: HQ's Today opens with that request's editor. */
export function editHqSlackRequest(id: string): void {
  setEditTarget(id)
  openHqScreen('today')
}

export function useHqSlackRequestEditTarget(): { id: string | null; clear: () => void } {
  const id = useSyncExternalStore(
    (listener) => {
      editListeners.add(listener)
      return () => editListeners.delete(listener)
    },
    () => editTarget
  )
  return { id, clear: () => setEditTarget(null) }
}

/** A bell or toast button by its action id; false when the request is gone or the write failed. */
export async function runHqSlackRequestAction(id: string, actionId: string): Promise<boolean> {
  if (actionId === HQ_SLACK_REQUEST_ACTION.edit) {
    editHqSlackRequest(id)
    return true
  }
  if (actionId === HQ_SLACK_REQUEST_ACTION.skip) {
    return skipHqSlackRequest(id)
  }
  const draft = await findDraft(id).catch(() => null)
  if (!draft) {
    toast.error(translate('auto.hq.slack.gone', 'This Slack request is already decided.'))
    return false
  }
  if (actionId === HQ_SLACK_REQUEST_ACTION.do) {
    return doHqSlackRequest(draft)
  }
  if (actionId === HQ_SLACK_REQUEST_ACTION.answer) {
    return answerHqSlackRequest(draft)
  }
  return false
}
