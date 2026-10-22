// Custom build (hq-mail-intake): the mail intake's live sources — Gmail, ClickUp, GitLab through glab
// and the pulse waitings — bound once at startup, with Settings' Gmail IPC.
import type { Store } from '../persistence'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { getGmailMail, listGmailMessageIds } from '../gmail/gmail-api'
import { gmailAccount } from '../gmail/gmail-credential-store'
import { getClickUpTask, getClickUpViewer, listClickUpTaskComments } from '../clickup/clickup-tasks'
import { glabExecFileAsync } from '../git/runner'
import { hqClickUpListProjects } from './hq-clickup-list-projects'
import { collectHqMailIntake, startHqMailIntake } from './hq-mail-intake'
import { notifyHqSlackScoutChanged } from './hq-slack-scout'
import { registerGmailHandlers } from '../ipc/gmail'

/** GitLab's word on an MR an email says was merged. */
async function gitLabMergedBy(event: {
  host: string
  projectPath: string
  iid: number
}): Promise<string | null | false> {
  const { stdout } = await glabExecFileAsync([
    'api',
    '--hostname',
    event.host,
    `projects/${encodeURIComponent(event.projectPath)}/merge_requests/${event.iid}`
  ])
  const mr: unknown = JSON.parse(stdout)
  if (!mr || typeof mr !== 'object' || Reflect.get(mr, 'state') !== 'merged') {
    return false
  }
  const by: unknown = Reflect.get(mr, 'merged_by')
  const name: unknown = by && typeof by === 'object' ? Reflect.get(by, 'name') : null
  return typeof name === 'string' && name ? name : null
}

export function registerHqMailIntake(store: Store, runtime: OrcaRuntimeService): void {
  registerGmailHandlers()
  startHqMailIntake({
    hqPath: () => store.getSettings().hqPath ?? null,
    enabled: () => store.getSettings().hqChatsView !== false && gmailAccount() !== null,
    collect: async (hq) =>
      collectHqMailIntake(hq, {
        listMailIds: listGmailMessageIds,
        getMail: getGmailMail,
        getTask: getClickUpTask,
        listComments: listClickUpTaskComments,
        viewer: getClickUpViewer,
        projectForList: await hqClickUpListProjects(
          hq,
          store.getSettings().hqProjectClickUpLists ?? {}
        ),
        listOpenWaitings: () => runtime.pulseListWaitings({ status: 'open' }),
        mergedBy: gitLabMergedBy,
        closeWaiting: (id, resolution) =>
          void runtime.pulseCloseWaiting(id, 'resolved', resolution),
        notify: (title, body) =>
          void runtime.dispatchPluginNotification({ pluginId: 'HQ', title, body }),
        now: Date.now
      }),
    onAdded: notifyHqSlackScoutChanged
  })
}
