// Custom build (hq-clickup-ledger, owner 03.11, plan stage 20.4): the ClickUp reader of the request
// ledger, wired to the ClickUp API, the HQ project pages and the pulse database.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  HQ_SLACK_SCOUT_CONFIG_FILE,
  HQ_SLACK_SCOUT_DIR,
  parseHqSlackScoutTuning
} from '../../shared/hq-slack-scout'
import type { Store } from '../persistence'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import {
  getClickUpTask,
  getClickUpViewer,
  listClickUpCommentReplies,
  listClickUpTaskComments,
  listClickUpTasks
} from '../clickup/clickup-tasks'
import { listHqProjectPages } from '../hq-project-pages/hq-project-pages'
import { hqClickUpListProjects } from './hq-clickup-list-projects'
import { hqClickUpWatchedTasks, startHqClickUpLedgerReader } from './hq-clickup-ledger-reader'
import { hqLedgerErrorReporter } from './hq-ledger-errors'
import { hqIntakeNamedProject } from './hq-slack-intake-suggest'

export function registerHqClickUpLedger(store: Store, runtime: OrcaRuntimeService): () => void {
  let forList: (listId: string | null) => string | null = () => null
  return startHqClickUpLedgerReader(
    {
      enabled: () => store.getSettings().hqLedger !== 'off' && !!store.getSettings().hqPath,
      listMyTasks: async () => {
        // Why here: the owner may bind a list to a project between passes.
        const hq = store.getSettings().hqPath
        if (hq) {
          forList = await hqClickUpListProjects(hq, store.getSettings().hqProjectClickUpLists ?? {})
        }
        return listClickUpTasks({ scope: 'mine', includeDone: true }, 50)
      },
      watchedTasks: () => hqClickUpWatchedTasks(Date.now()),
      getTask: getClickUpTask,
      listComments: listClickUpTaskComments,
      listReplies: listClickUpCommentReplies,
      viewer: getClickUpViewer,
      projectForList: (listId) => forList(listId),
      ownAccounts: async () => {
        const hq = store.getSettings().hqPath
        const text = hq
          ? await readFile(join(hq, HQ_SLACK_SCOUT_DIR, HQ_SLACK_SCOUT_CONFIG_FILE), 'utf8').catch(
              () => ''
            )
          : ''
        return new Set(parseHqSlackScoutTuning(text).clickUpIgnoreAuthors)
      },
      projectOfLinks: async (links) => {
        const hq = store.getSettings().hqPath
        return hq
          ? (hqIntakeNamedProject({ text: '', links: [...links] }, await listHqProjectPages(hq))
              ?.slug ?? null)
          : null
      },
      ingest: (signal) => runtime.pulseIngestLedger(signal),
      now: Date.now
    },
    // Why: a reader failing in silence leaves the conversations stale with no word anywhere.
    hqLedgerErrorReporter('hq-clickup-ledger', 'ClickUp comments not read', (rows) =>
      runtime.pulseRecordJournal(rows)
    )
  )
}
