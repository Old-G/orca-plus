// Custom build (hq-slack-requests): what the four answers to a Slack request do — the same from HQ's
// card, the bell and the toast. Each records the owner's decision, so the scout never brings it back.
import { useSyncExternalStore } from 'react'
import { toast } from 'sonner'
import type { HqSlackScoutDraft } from '../../../../../shared/hq-slack-scout'
import { HQ_SLACK_REQUEST_ACTION } from '../../../../../shared/hq-slack-request-bell'
import { translate } from '@/i18n/i18n'
import { openHqScreen } from '../hq/hq-view'

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

/** «Do»: the ClickUp task, from the draft as it stands (with the owner's corrections). */
export async function doHqSlackRequest(
  draft: Pick<HqSlackScoutDraft, 'id' | 'title' | 'description'>
): Promise<boolean> {
  const result = await window.api.hqProjects
    .createSlackDraftTask({
      id: draft.id,
      title: draft.title.trim(),
      description: draft.description
    })
    .catch(failed)
  if (!result.ok) {
    return settle(result)
  }
  toast.success(translate('auto.hq.slack.created', 'Task created in ClickUp'), {
    action: {
      label: translate('auto.hq.slack.open', 'Open'),
      onClick: () => void window.api.shell.openUrl(result.taskUrl)
    }
  })
  return true
}

/** «Just reply»: the thread opens for the owner's own answer; no task. */
export async function answerHqSlackRequest(
  draft: Pick<HqSlackScoutDraft, 'id' | 'permalink'>
): Promise<boolean> {
  if (draft.permalink) {
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
