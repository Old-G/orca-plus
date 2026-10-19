// Custom build (hq-slack-requests): what the four answers to a Slack request do — the same from HQ's
// card, the bell and the toast. Each records the owner's decision, so the scout never brings it back.
import { useSyncExternalStore } from 'react'
import { toast } from 'sonner'
import {
  HQ_REPLY_CORRECTIONS_FILE,
  HQ_SLACK_SCOUT_DIR,
  type HqSlackScoutDraft
} from '../../../../../shared/hq-slack-scout'
import { HQ_SLACK_REQUEST_ACTION } from '../../../../../shared/hq-slack-request-bell'
import {
  HQ_TONE_GUIDE_PATH,
  hqSlackReplyPrompt,
  hqSlackThread,
  type HqReplyStyleFiles
} from '../../../../../shared/hq-slack-request-prompts'
import { withHqTakeEffort } from '../../../../../shared/hq-triage'
import { isGitRepoKind } from '../../../../../shared/repo-kind'
import { translate } from '@/i18n/i18n'
import { joinPath } from '@/lib/path'
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
import { reviewHqClickUpRequest } from './hq-clickup-review-action'

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

/** Custom build (hq-reply-tone): where a reply agent reads the owner's tone and his past edits. */
function hqReplyStyleFiles(): HqReplyStyleFiles | null {
  const hq = useAppStore.getState().settings?.hqPath
  return hq
    ? {
        tonePath: joinPath(hq, HQ_TONE_GUIDE_PATH),
        correctionsPath: joinPath(hq, `${HQ_SLACK_SCOUT_DIR}/${HQ_REPLY_CORRECTIONS_FILE}`)
      }
    : null
}

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
    markTaken: (id) => window.api.hqProjects.takeSlackDraft({ id }),
    replyStyle: hqReplyStyleFiles,
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
  draft: Pick<
    HqSlackScoutDraft,
    'id' | 'title' | 'description' | 'project' | 'permalink' | 'clickupTaskId'
  >
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
    case 'not-started':
      toast.error(
        translate('auto.hq.slack.notStarted', 'Claude did not start on the task; nothing changed.'),
        { action: openTaskAction(outcome.taskUrl) }
      )
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
 *  Without the HQ workspace the thread opens for the owner's own answer. A ClickUp comment gets the
 *  reply composer in HQ's Today instead. */
export async function answerHqSlackRequest(
  draft: Pick<HqSlackScoutDraft, 'id' | 'permalink' | 'source'>
): Promise<boolean> {
  if (draft.source === 'clickup') {
    openHqSlackRequest(draft.id, 'reply')
    return false
  }
  const thread = hqSlackThread(draft)
  const state = useAppStore.getState()
  const hqWorktreeId = findHqWorktreeId(state.settings?.hqPath, state.repos, state.worktreesByRepo)
  if (thread && hqWorktreeId) {
    const launched = launchHqCommand(hqWorktreeId, hqSlackReplyPrompt(thread, hqReplyStyleFiles()))
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

/** Which panel of a request the bell or a toast opened: the editor, or a ClickUp reply composer. */
export type HqSlackRequestOpenMode = 'edit' | 'reply'

type OpenTarget = { id: string; mode: HqSlackRequestOpenMode }

let openTarget: OpenTarget | null = null
const openListeners = new Set<() => void>()

function setOpenTarget(target: OpenTarget | null): void {
  openTarget = target
  for (const listener of openListeners) {
    listener()
  }
}

function openHqSlackRequest(id: string, mode: HqSlackRequestOpenMode): void {
  setOpenTarget({ id, mode })
  openHqScreen('today')
}

/** «Edit» from the bell or a toast: HQ's Today opens with that request's editor. */
export function editHqSlackRequest(id: string): void {
  openHqSlackRequest(id, 'edit')
}

export function useHqSlackRequestEditTarget(): {
  id: string | null
  mode: HqSlackRequestOpenMode | null
  clear: () => void
} {
  const target = useSyncExternalStore(
    (listener) => {
      openListeners.add(listener)
      return () => openListeners.delete(listener)
    },
    () => openTarget
  )
  return { id: target?.id ?? null, mode: target?.mode ?? null, clear: () => setOpenTarget(null) }
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
  if (actionId === HQ_SLACK_REQUEST_ACTION.review) {
    await reviewHqClickUpRequest(id)
    return false
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
