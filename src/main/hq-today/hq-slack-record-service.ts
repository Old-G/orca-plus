// Custom build (hq-slack-requests): HQ's calls that read the requests and record the owner's answers
// to them; every failure comes back as `{ok: false}` for the card to show.
import type {
  HqSlackScoutCreateResult,
  HqSlackScoutEdit,
  HqSlackScoutResult
} from '../../shared/hq-slack-scout'
import {
  answerHqSlackScoutDraft,
  editHqSlackScoutDraft,
  readHqSlackScout,
  rejectHqSlackScoutDraft,
  restoreHqSlackScoutDraft,
  takeHqSlackScoutDraft
} from './hq-slack-scout'

type Written = { ok: true } | { ok: false; error: string }

export type HqSlackRecordService = {
  /** Custom build (hq-slack-scout): the scout's drafts the owner has not decided yet. */
  slackDrafts(): Promise<HqSlackScoutResult>
  rejectSlackDraft(id: string): Promise<HqSlackScoutCreateResult | Written>
  /** Custom build (hq-slack-requests): the owner replies in the thread himself; no task. */
  answerSlackDraft(id: string): Promise<HqSlackScoutCreateResult | Written>
  editSlackDraft(
    edit: HqSlackScoutEdit & { id: string }
  ): Promise<HqSlackScoutCreateResult | Written>
  /** Custom build (hq-clickup-requests): «Do» took the request's existing ClickUp task. */
  takeSlackDraft(id: string): Promise<HqSlackScoutCreateResult | Written>
  /** Custom build (hq-done-journal): a skipped request back among the pending ones. */
  restoreSlackDraft(id: string): Promise<Written>
}

export function createHqSlackRecordService(hqPath: () => string | null): HqSlackRecordService {
  const write = async (record: (hq: string) => Promise<void>): Promise<Written> => {
    const hq = hqPath()
    if (!hq) {
      return { ok: false, error: 'No HQ folder is set.' }
    }
    try {
      await record(hq)
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }
  return {
    async slackDrafts() {
      const hq = hqPath()
      return hq
        ? readHqSlackScout(hq)
        : { ok: true, configured: false, lastRunAt: null, failedAt: null, drafts: [] }
    },
    rejectSlackDraft: (id) => write((hq) => rejectHqSlackScoutDraft(hq, id)),
    answerSlackDraft: (id) => write((hq) => answerHqSlackScoutDraft(hq, id)),
    editSlackDraft: ({ id, ...edit }) => write((hq) => editHqSlackScoutDraft(hq, id, edit)),
    takeSlackDraft: (id) => write((hq) => takeHqSlackScoutDraft(hq, id)),
    restoreSlackDraft: (id) => write((hq) => restoreHqSlackScoutDraft(hq, id))
  }
}
