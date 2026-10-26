// Custom build (hq-slack-intake): the 👾 watch and the «To work» card's buttons, wired to Orca+.
import { ipcMain } from 'electron'
import { HQ_INTAKE_KIND } from '../../shared/hq-slack-intake'
import { parseSlackThreadRef } from '../../shared/hq-waiting-replies'
import type { Store } from '../persistence'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { listHqProjectPages } from '../hq-project-pages/hq-project-pages'
import { deliverToNativeChat } from '../orca-plus/waiting-replies/deliver-waiting-reply'
import { withSlackReader } from '../slack/slack-reader'
import {
  createSlackIntakeApi,
  createSlackReadApi,
  type SlackReaderCache
} from '../slack/slack-reader-api'
import {
  closeHqIntake,
  keepHqIntakeInNotes,
  type HqIntakeActionDeps
} from './hq-slack-intake-actions'
import { guessHqIntake } from './hq-slack-intake-suggest'
import { startHqSlackIntake } from './hq-slack-intake'
import { generateHqText } from './hq-task-questions'

const RAISED_LOOKBACK_MS = 8 * 24 * 60 * 60_000
// Why: routing a message is a small judgement; HQ's main text model would be slow and dear here.
const INTAKE_MODEL = 'haiku'

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function registerHqSlackIntake(
  store: Store,
  runtime: OrcaRuntimeService,
  cache: SlackReaderCache
): void {
  const people = () => runtime.pulseListPeople()
  startHqSlackIntake({
    read: (run) =>
      withSlackReader((token, owner) => {
        const names = createSlackReadApi(token, owner, cache)
        const name = async (userId: string) =>
          people().find((person) => person.slackUserId === userId)?.name ??
          (await names.userName(userId))
        return run(createSlackIntakeApi(token, owner, name, (userId) => names.isBot(userId)))
      }),
    raised: () =>
      new Map(
        runtime
          .pulseListInbox(true, { kind: HQ_INTAKE_KIND, since: Date.now() - RAISED_LOOKBACK_MS })
          .flatMap((item) => (item.dedupeKey ? [[item.dedupeKey, item.refId] as const] : []))
      ),
    handled: () =>
      new Set(
        runtime
          .pulseListInbox(true, { kind: HQ_INTAKE_KIND, since: Date.now() - RAISED_LOOKBACK_MS })
          .flatMap((item) => (item.dedupeKey && item.doneAt !== null ? [item.dedupeKey] : []))
      ),
    answers: () =>
      runtime.pulseListWaitings({ direction: 'on-them' }).flatMap((waiting) => {
        const thread = parseSlackThreadRef(waiting.sourceRef)
        const at = waiting.replyTs ? Math.round(Number(waiting.replyTs) * 1000) : 0
        return thread && at > Date.now() - RAISED_LOOKBACK_MS
          ? [{ channel: thread.channel, authorSlackId: waiting.replyAuthorId ?? null, at }]
          : []
      }),
    guess: (draft) =>
      guessHqIntake(draft, {
        pages: async () => {
          const hqPath = store.getSettings().hqPath
          return hqPath ? listHqProjectPages(hqPath) : []
        },
        authorProjects: (slackUserId) => {
          const person = people().find((entry) => entry.slackUserId === slackUserId)
          return person
            ? runtime
                .pulseListWaitings({ status: 'open' })
                .filter((waiting) => waiting.personId === person.id && waiting.project)
                .map((waiting) => waiting.project ?? '')
            : []
        },
        generate: async (prompt) => {
          const hqPath = store.getSettings().hqPath
          return hqPath
            ? generateHqText(
                prompt,
                {
                  emptyResultName: 'intake route',
                  operation: 'hq-slack-intake',
                  model: INTAKE_MODEL
                },
                {
                  settings: store.getSettings(),
                  cwd: hqPath,
                  getAgentEnvResolvers: () => runtime.getCommitMessageAgentEnvironmentResolvers()
                }
              )
            : { ok: false, error: 'No HQ folder is set.' }
        }
      }),
    sync: (kind, items) => void runtime.pulseSyncInboxKind(kind, items),
    now: Date.now
  })

  const deps: HqIntakeActionDeps = {
    openItems: () => runtime.pulseListInbox(false, { kind: HQ_INTAKE_KIND }),
    people,
    addPerson: (name, slackUserId) => runtime.pulseUpsertPerson({ name, slackUserId }),
    openWaitings: () => runtime.pulseListWaitings({ status: 'open' }),
    addWaiting: (input) => runtime.pulseAddWaiting(input),
    closeWaiting: (id, resolution) => void runtime.pulseCloseWaiting(id, 'resolved', resolution),
    markRead: (itemId) => void runtime.pulseMarkInboxRead(itemId),
    markDone: (itemId, action) => void runtime.pulseMarkInboxDone(itemId, action)
  }
  ipcMain.handle('hqIntake:sendToSession', async (_event, sessionId: unknown, prompt: unknown) =>
    typeof sessionId === 'string' && text(prompt)
      ? (await deliverToNativeChat(sessionId, text(prompt), 'hq-slack-intake'))
        ? { ok: true }
        : { ok: false, reason: 'chat-closed' }
      : { ok: false, reason: 'gone' }
  )
  ipcMain.handle('hqIntake:later', (_event, itemId: unknown, project: unknown, note: unknown) =>
    keepHqIntakeInNotes(deps, text(itemId), { project: text(project) || null, note: text(note) })
  )
  ipcMain.handle(
    'hqIntake:close',
    (_event, itemId: unknown, action: unknown, resolution: unknown) =>
      closeHqIntake(deps, text(itemId), {
        action: action === 'sent' ? 'sent' : 'skipped',
        resolution: text(resolution) || 'Handled'
      })
  )
}
