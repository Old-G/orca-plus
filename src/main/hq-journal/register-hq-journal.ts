// Custom build (hq-plus-journal): starts HQ+'s journal — it follows every pulse write, re-reads the
// Codex reports on a timer, and serves `hq.events` / `hq.whoami` through the runtime RPC.
import type { Store } from '../persistence'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { onPulseChanged } from '../orca-plus/pulse/pulse-change-events'
import { PULSE_BELL_KIND } from '../../shared/pulse-bell'
import { createHqJournalService, provideHqJournalService } from './hq-journal-service'

// Why: the evening review writes its report once a day; the pulse writes wake the journal sooner.
const REREAD_EVERY_MS = 5 * 60_000

export function registerHqJournal(store: Store, runtime: OrcaRuntimeService): void {
  const service = createHqJournalService({
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
    sessionWorkspace: (sessionId) => {
      try {
        const location = runtime.openedAgentSessionRecordStore()?.getRecord(sessionId)?.location
        if (!location) {
          return null
        }
        return location.workspaceKind === 'folder' && !location.workspaceId.startsWith('folder:')
          ? `folder:${location.workspaceId}`
          : location.workspaceId
      } catch {
        return null
      }
    },
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
  onPulseChanged(() => service.schedule())
  const timer = setInterval(() => service.schedule(), REREAD_EVERY_MS)
  timer.unref?.()
  service.schedule()
}
