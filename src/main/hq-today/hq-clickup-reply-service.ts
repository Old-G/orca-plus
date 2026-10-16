// Custom build (hq-clickup-requests): HQ's ClickUp reply calls, wired to the ClickUp API and HQ's
// tool-less text model; every failure comes back as `{ok: false}` for the card to show.
import type { GlobalSettings } from '../../shared/global-settings-types'
import {
  addClickUpTaskComment,
  getClickUpTask,
  listClickUpTaskComments
} from '../clickup/clickup-tasks'
import {
  draftHqClickUpReply,
  sendHqClickUpReply,
  type HqClickUpReplyDeps
} from './hq-clickup-reply'
import { answerHqSlackScoutDraft, readHqSlackScout } from './hq-slack-scout'
import { generateHqText, type HqTextGenerationDeps } from './hq-task-questions'

type Failure = { ok: false; error: string }

export type HqClickUpReplyService = {
  draftClickUpReply(id: string): Promise<{ ok: true; text: string } | Failure>
  sendClickUpReply(reply: {
    id: string
    text: string
    draft?: string
  }): Promise<{ ok: true } | Failure>
}

export function createHqClickUpReplyService(deps: {
  hqPath: () => string | null
  settings: () => GlobalSettings
  getAgentEnvResolvers: HqTextGenerationDeps['getAgentEnvResolvers']
}): HqClickUpReplyService {
  const replyDeps = (hq: string): HqClickUpReplyDeps => ({
    readScout: readHqSlackScout,
    getTask: getClickUpTask,
    listComments: listClickUpTaskComments,
    addComment: addClickUpTaskComment,
    generate: (prompt) =>
      generateHqText(
        prompt,
        { emptyResultName: 'reply', operation: 'hq-clickup-reply' },
        { settings: deps.settings(), cwd: hq, getAgentEnvResolvers: deps.getAgentEnvResolvers }
      ),
    answered: (path, id) => answerHqSlackScoutDraft(path, id),
    now: Date.now
  })

  const inHq = async <T>(run: (hq: string) => Promise<T | Failure>): Promise<T | Failure> => {
    const hq = deps.hqPath()
    if (!hq) {
      return { ok: false, error: 'No HQ folder is set.' }
    }
    try {
      return await run(hq)
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  return {
    draftClickUpReply: (id) => inHq((hq) => draftHqClickUpReply(hq, id, replyDeps(hq))),
    sendClickUpReply: (reply) => inHq((hq) => sendHqClickUpReply(hq, reply, replyDeps(hq)))
  }
}
