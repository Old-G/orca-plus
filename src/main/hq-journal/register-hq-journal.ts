// Custom build (hq-plus-journal): starts HQ+'s journal — it follows every pulse write, re-reads the
// Codex reports on a timer, and serves `hq.*` and `chat.send` through the runtime RPC.
import type { Store } from '../persistence'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { onPulseChanged } from '../orca-plus/pulse/pulse-change-events'
import { PULSE_BELL_KIND } from '../../shared/pulse-bell'
import { createHqJournalService, provideHqJournalService } from './hq-journal-service'
import { createHqThreads, provideHqThreads } from './hq-journal-threads'
import { registerHqSessions } from '../hq-sessions/register-hq-sessions'
import { deliverToNativeChat } from '../orca-plus/waiting-replies/deliver-waiting-reply'
import { runHqReopenChatOnDesktop } from '../hq-today/hq-request-on-desktop'
import { existsSync } from 'node:fs'
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

// Why: the evening review writes its report once a day; the pulse writes wake the journal sooner.
const REREAD_EVERY_MS = 5 * 60_000

export function registerHqJournal(store: Store, runtime: OrcaRuntimeService): void {
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
  registerHqContext(store, runtime, service)
  provideHqThreads(
    createHqThreads({
      enabled,
      scope: (caller) => service.scope(caller),
      pulse: {
        record: (inputs) => runtime.pulseRecordJournal(inputs),
        list: (query) => runtime.pulseListJournal(query),
        getSession: (sessionId) => runtime.pulseGetSession(sessionId),
        noteSessions: (inputs) => runtime.pulseNoteSessions(inputs),
        listSessionsByAddress: (address) => runtime.pulseListSessionsByAddress(address),
        getEntry: (id) => runtime.pulseGetJournalEntry(id),
        listPeople: () => runtime.pulseListPeople(),
        upsertPerson: (input) => runtime.pulseUpsertPerson(input)
      },
      sessionName: (sessionId) => record(sessionId)?.conversationName?.trim() || null,
      sessionWorkspace,
      deliver: (sessionId, prompt) => deliverToNativeChat(sessionId, prompt, 'hq-chat-send'),
      reopen: (sessionId, worktreeId) => runHqReopenChatOnDesktop(sessionId, worktreeId).ok,
      wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      now: Date.now
    })
  )
  registerHqSessions(store, runtime, service)
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
