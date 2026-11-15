// Custom build (hq-mr-comments, T14 of plan 2026-11-14): wires the MR comment reader to glab, HQ's
// config (`gitlab_groups`, `gitlab_bots`), its projects and the ledger.
import type { Store } from '../persistence/loading-store/store'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { HQ_MR_HOST } from '../../shared/hq-mr-watch'
import { parseHqScoutConfigValues } from '../../shared/hq-slack-scout'
import { listHqProjectPages } from '../hq-project-pages/hq-project-pages'
import { hqLedgerErrorReporter } from './hq-ledger-errors'
import { hqMrChatOfBranch } from './hq-mr-chat'
import { startHqGitLabMrNotes } from './hq-gitlab-mr-notes'

function usernameOf(user: unknown): string | null {
  const name = user && typeof user === 'object' ? Reflect.get(user, 'username') : null
  return typeof name === 'string' && name ? name : null
}

/** Custom build (hq-mr-comments, T14): people's plain comments on the owner's open MRs into the ledger. */
export function registerHqGitLabMrNotes(
  store: Store,
  runtime: OrcaRuntimeService,
  readConfig: () => Promise<string>,
  glabJson: (host: string, path: string) => Promise<unknown>
): void {
  let owner: string | null = null
  const configList = async (name: string): Promise<string[]> =>
    [...(parseHqScoutConfigValues(await readConfig()).get(name) ?? '').matchAll(/[\w./-]+/g)].map(
      (match) => match[0]
    )
  startHqGitLabMrNotes(
    {
      enabled: () => store.getSettings().hqLedger !== 'off',
      listOpenMrs: async (username) => {
        const lists = await Promise.all(
          (await configList('gitlab_groups')).map((group) =>
            glabJson(
              HQ_MR_HOST,
              `groups/${encodeURIComponent(group)}/merge_requests?state=opened&scope=all&author_username=${encodeURIComponent(username)}&per_page=100`
            )
          )
        )
        return lists.flatMap((list) => (Array.isArray(list) ? list : []))
      },
      listNotes: (projectId, iid, perPage) =>
        glabJson(
          HQ_MR_HOST,
          `projects/${String(projectId)}/merge_requests/${String(iid)}/notes?sort=desc&order_by=created_at&per_page=${String(perPage)}`
        ),
      owner: async () => {
        if (!owner) {
          const username = usernameOf(await glabJson(HQ_MR_HOST, 'user'))
          if (!username) {
            throw new Error('GitLab did not say whose merge requests these are')
          }
          owner = username
        }
        return owner
      },
      bots: () => configList('gitlab_bots'),
      projects: async () => {
        const hq = store.getSettings().hqPath
        return hq ? (await listHqProjectPages(hq)).map((page) => page.slug) : []
      },
      ingest: (signal) => runtime.pulseIngestLedger(signal),
      chatOfBranch: hqMrChatOfBranch(store, runtime),
      setChatIfNone: (key, sessionId) => runtime.pulseSetConversationChatIfNone(key, sessionId),
      warn: (message, detail) => console.warn(`[hq-gitlab-mr-notes] ${message}\n${detail}`),
      now: Date.now
    },
    hqLedgerErrorReporter('hq-gitlab-mr-notes', 'GitLab MR comments not read', (rows) =>
      runtime.pulseRecordJournal(rows)
    )
  )
}
