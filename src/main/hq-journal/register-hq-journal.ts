// Custom build (hq-plus-journal): starts HQ+'s journal — it follows every pulse write, re-reads the
// Codex reports on a timer, and serves `hq.*` and `chat.send` through the runtime RPC.
import type { Store } from '../persistence/loading-store/store'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { onPulseChanged } from '../orca-plus/pulse/pulse-change-events'
import { PULSE_BELL_KIND } from '../../shared/pulse-bell'
import { createHqJournalService, provideHqJournalService } from './hq-journal-service'
import { effortJournal } from './hq-effort-journal'
import { hqPlaceOf } from './hq-journal-rooms'
import { provideAutoEffortLog } from '../native-chat/auto-effort/native-chat-auto-effort'
import { createHqThreads, provideHqThreads, type HqThreadsDeps } from './hq-journal-threads'
import { hqDeliverLeadBatch, hqLeadBatchGiveUp, hqLeadBatchSession } from './hq-journal-send'
import { createHqLeadBatch, HQ_LEAD_BATCH_FILE, parseHqLeadHeld } from './hq-lead-batch'
import { registerHqSessions } from '../hq-sessions/register-hq-sessions'
import { getHqSessions } from '../hq-sessions/hq-sessions'
import { createHqLeadReassign, provideHqLeadReassign } from './hq-lead-reassign'
import { hqRewritePlanLeads } from './hq-lead-plan-line'
import { deliverToNativeChat } from '../orca-plus/waiting-replies/deliver-waiting-reply'
import { provideNativeChatTabReveal } from '../orca-plus/waiting-replies/native-chat-tab-reveal'
import { getStructuredAgentSessionHost } from '../native-chat/agent-session-wire/host/structured-agent-session-registry'
import { runHqReopenChatOnDesktop } from '../hq-today/hq-request-on-desktop'
import { existsSync } from 'node:fs'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import {
  createHqPlusStats,
  provideHqPlusStats,
  runPython
} from '../hq-plus-ui/hq-plus-screen-stats'

const MANUAL_SCRIPT = ['hq-skills', 'weekly-improve', 'scripts', 'manual_routing.py']

/** The bundled 17.11 counter, else the installed skill's copy. */
function manualRoutingScript(): string | null {
  const candidates = [
    app.isPackaged
      ? join(process.resourcesPath, ...MANUAL_SCRIPT)
      : join(app.getAppPath(), 'resources', ...MANUAL_SCRIPT),
    join(homedir(), '.claude', 'skills', ...MANUAL_SCRIPT.slice(1))
  ]
  return candidates.find((path) => existsSync(path)) ?? null
}
import { registerHqContext } from '../hq-context/register-hq-context'
import { registerHqBrain } from '../hq-brain/register-hq-brain'
import { setHqSpaceLiveGroups } from '../hq-today/hq-spaces'

// Why: the evening review writes its report once a day; the pulse writes wake the journal sooner.
const REREAD_EVERY_MS = 5 * 60_000

export function registerHqJournal(store: Store, runtime: OrcaRuntimeService): void {
  // Custom build (hq-rooms): rooms read the sidebar's groups live, not HQ's pages of a past sync.
  setHqSpaceLiveGroups(() => ({ repos: store.getRepos(), groups: store.getProjectGroups() }))
  const record = (sessionId: string) => {
    try {
      return runtime.openedAgentSessionRecordStore()?.getRecord(sessionId) ?? null
    } catch {
      return null
    }
  }
  const sessionWorkspace = (sessionId: string): string | null => {
    const location = record(sessionId)?.location
    if (!location) {
      return null
    }
    return location.workspaceKind === 'folder' && !location.workspaceId.startsWith('folder:')
      ? `folder:${location.workspaceId}`
      : location.workspaceId
  }
  // Custom build (chat-tab-reveal): a chat any Orca+ delivery writes to (`orca chat send`, a
  // person's answer, a restart notice) gets its tab back in the sidebar if it was closed.
  provideNativeChatTabReveal({
    tabShown: (sessionId) =>
      getStructuredAgentSessionHost()?.isSessionTabVisible(sessionId) ?? true,
    reveal: async (sessionId) => {
      const host = getStructuredAgentSessionHost()
      if (!host) {
        throw new Error('No chat host on this Mac.')
      }
      return host.revealSession(sessionId)
    },
    publish: (tab) => runtime.publishStructuredAgentSessionTab(tab)
  })
  const enabled = (): boolean => store.getSettings().hqPlusJournalEnabled !== false
  const service = createHqJournalService({
    enabled,
    hqPath: () => store.getSettings().hqPath ?? null,
    repos: () =>
      store
        .getRepos()
        .map((repo) => ({ id: repo.id, path: repo.path, displayName: repo.displayName })),
    folderGroup: (folderWorkspaceId) => {
      const folder = store.getFolderWorkspaces().find((entry) => entry.id === folderWorkspaceId)
      return folder
        ? (store.getProjectGroups().find((group) => group.id === folder.projectGroupId)?.name ??
            null)
        : null
    },
    sessionWorkspace,
    pulse: {
      listWaitings: () => runtime.pulseListWaitings({}),
      listDrafts: () => runtime.pulseListDrafts(),
      listDecisions: (limit) => runtime.pulseListDecisions(limit),
      listFinishedChats: (since) =>
        runtime.pulseListInbox(true, { kind: PULSE_BELL_KIND.agentFinished, since }),
      listBell: (since) => runtime.pulseListInbox(true, { since }),
      listPeople: () => runtime.pulseListPeople(),
      record: (inputs) => runtime.pulseRecordJournal(inputs),
      noteSessions: (inputs) => runtime.pulseNoteSessions(inputs),
      getSession: (sessionId) => runtime.pulseGetSession(sessionId),
      list: (query) => runtime.pulseListJournal(query)
    },
    now: Date.now,
    log: (message) => console.log('[hq-journal]', message)
  })
  provideHqJournalService(service)
  // Custom build (hq-plus-ladder): each message's effort goes to the journal, while it is on.
  provideAutoEffortLog((entry) => {
    if (!enabled()) {
      return
    }
    void service
      .sources()
      .then((sources) =>
        runtime.pulseRecordJournal([effortJournal(entry, (ref) => hqPlaceOf(sources, ref))])
      )
      .catch((error: unknown) => console.warn('[hq-journal] effort row failed:', error))
  })
  registerHqContext(store, runtime, service)
  // Custom build (hq-plus-brain): the «Brain» screen's host side.
  registerHqBrain(store, runtime)
  const threadPulse = {
    record: (inputs) => runtime.pulseRecordJournal(inputs),
    list: (query) => runtime.pulseListJournal(query),
    getSession: (sessionId) => runtime.pulseGetSession(sessionId),
    noteSessions: (inputs) => runtime.pulseNoteSessions(inputs),
    listSessionsByAddress: (address) => runtime.pulseListSessionsByAddress(address),
    getEntry: (id) => runtime.pulseGetJournalEntry(id),
    listPeople: () => runtime.pulseListPeople(),
    upsertPerson: (input) => runtime.pulseUpsertPerson(input),
    linkChat: (input) => runtime.pulseChats().link(input),
    roleOf: (sessionId) => runtime.pulseChats().roleOf(sessionId),
    setRole: (input) => runtime.pulseChats().setRole(input),
    leadMoveOf: (chat, lead) => runtime.pulseChats().leadMoveOf(chat, lead)
  } satisfies HqThreadsDeps['pulse']
  const delivery = {
    pulse: threadPulse,
    sessionWorkspace,
    deliver: (sessionId: string, prompt: string) =>
      deliverToNativeChat(sessionId, prompt, 'hq-chat-send'),
    reopen: (sessionId: string, worktreeId: string) =>
      runHqReopenChatOnDesktop(sessionId, worktreeId).ok,
    wait: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
  }
  // Custom build (hq-lead-batch): a Lead's messages from other chats wait here for one turn.
  const leadBatchFile = join(app.getPath('userData'), HQ_LEAD_BATCH_FILE)
  const leadBatch = createHqLeadBatch({
    busy: (held) => {
      const status = getStructuredAgentSessionHost()?.readStatusSummary(
        hqLeadBatchSession(threadPulse, held)
      )?.status
      return status === 'working' || status === 'attention'
    },
    flush: (held, prompt) => hqDeliverLeadBatch(delivery, held, prompt),
    giveUp: (held, prompt) =>
      hqLeadBatchGiveUp({ pulse: threadPulse, now: Date.now }, held, prompt),
    load: async () => parseHqLeadHeld(await readFile(leadBatchFile, 'utf8').catch(() => '[]')),
    // Why: written aside and renamed, so a crash mid-write cannot leave a cut file that reads as none.
    save: async (held) => {
      await writeFile(`${leadBatchFile}.tmp`, JSON.stringify(held))
      await rename(`${leadBatchFile}.tmp`, leadBatchFile)
    },
    now: Date.now,
    schedule: (run, ms) => {
      const timer = setTimeout(run, ms)
      timer.unref?.()
      return () => clearTimeout(timer)
    },
    log: (message) => console.warn('[hq-lead-batch]', message)
  })
  void leadBatch.start()
  provideHqThreads(
    createHqThreads({
      ...delivery,
      enabled,
      scope: (caller) => service.scope(caller),
      sessionName: (sessionId) => record(sessionId)?.conversationName?.trim() || null,
      now: Date.now,
      leadBatch
    })
  )
  registerHqSessions(store, runtime, service)
  // Custom build (hq-lead-reassign): `orca hq reassign` hands a Lead's chats to another chat.
  provideHqLeadReassign(
    createHqLeadReassign({
      enabled,
      scope: (caller) => service.scope(caller),
      pulse: {
        getSession: (sessionId) => runtime.pulseGetSession(sessionId),
        listSessionsByAddress: (address) => runtime.pulseListSessionsByAddress(address),
        record: (inputs) => runtime.pulseRecordJournal(inputs),
        roleOf: (sessionId) => runtime.pulseChats().roleOf(sessionId),
        setRole: (input) => runtime.pulseChats().setRole(input)
      },
      chats: {
        links: () => runtime.pulseChats().list(),
        moveLead: (input) => runtime.pulseChats().moveLead(input)
      },
      live: async () => (await getHqSessions()?.live()) ?? [],
      deliver: delivery.deliver,
      leadBatch,
      rewritePlans: async (from, to, at, dryRun) => {
        const hqPath = store.getSettings().hqPath
        return hqPath ? hqRewritePlanLeads(hqPath, from, to, at, dryRun) : []
      },
      now: Date.now
    })
  )
  provideHqPlusStats(
    createHqPlusStats({
      hqPath: () => store.getSettings().hqPath ?? null,
      script: manualRoutingScript,
      run: runPython,
      now: Date.now
    })
  )
  onPulseChanged(() => service.schedule())
  const timer = setInterval(() => service.schedule(), REREAD_EVERY_MS)
  timer.unref?.()
  service.schedule()
}
