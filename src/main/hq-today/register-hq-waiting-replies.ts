// Custom build (hq-waiting-replies, slack-reply-reader, hq-reply-approve): everything between a
// question a chat asked and the answer reaching it — the scout's files, Orca+'s own Slack reads, and
// the owner's Pass / Skip on each answer.
import { ipcMain } from 'electron'
import type { HqWaitingReplyPassResult } from '../../shared/hq-waiting-reply-bell'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import type { Store } from '../persistence'
import { onPulseChanged } from '../orca-plus/pulse/pulse-change-events'
import { deliverWaitingReply } from '../orca-plus/waiting-replies/deliver-waiting-reply'
import { createSlackReadApi, createSlackReaderCache } from '../slack/slack-reader-api'
import { getSlackReaderStatus, withSlackReader } from '../slack/slack-reader'
import { startHqSlackWaitingReplies } from './hq-slack-waiting-replies'
import { startHqWaitingReplyRelay } from './hq-waiting-reply-relay'
import { passHqWaitingReply, skipHqWaitingReply } from './hq-waiting-reply-pass'
import { registerHqSlackIntake } from './register-hq-slack-intake'

export function registerHqWaitingReplies(store: Store, runtime: OrcaRuntimeService): void {
  const listOpen = () => runtime.pulseListWaitings({ status: 'open' })
  const people = () => runtime.pulseListPeople()
  const recordReply = runtime.pulseRecordWaitingReply.bind(runtime)
  const readsSlackItself = (): boolean => {
    const reader = getSlackReaderStatus()
    return reader.connected && !reader.error
  }

  startHqWaitingReplyRelay({
    hqPath: () => store.getSettings().hqPath ?? null,
    listOpen,
    personName: (id) => people().find((person) => person.id === id)?.name ?? null,
    recordReply,
    readsSlackItself,
    onChanged: onPulseChanged
  })

  const cache = createSlackReaderCache()
  startHqSlackWaitingReplies({
    listOpen,
    personSlackId: (id) => people().find((person) => person.id === id)?.slackUserId ?? null,
    knownName: (slackUserId) =>
      people().find((person) => person.slackUserId === slackUserId)?.name ?? null,
    read: (run) => withSlackReader((token, owner) => run(createSlackReadApi(token, owner, cache))),
    recordReply,
    now: Date.now
  })
  // Custom build (hq-slack-intake): 👾-marked messages, read with the same token and name cache.
  registerHqSlackIntake(store, runtime, cache)

  const passDeps = {
    listOpen,
    deliver: deliverWaitingReply,
    markDelivered: (id: string) => void runtime.pulseMarkWaitingReplyDelivered(id)
  }
  ipcMain.handle(
    'hqWaitingReply:pass',
    async (_event, waitingId: unknown): Promise<HqWaitingReplyPassResult> =>
      typeof waitingId === 'string'
        ? passHqWaitingReply(passDeps, waitingId)
        : { ok: false, reason: 'gone' }
  )
  ipcMain.handle('hqWaitingReply:skip', (_event, waitingId: unknown) => {
    if (typeof waitingId === 'string') {
      skipHqWaitingReply(passDeps, waitingId)
    }
  })
}
