// Custom build (hq-clickup-triage): the ClickUp triage's live sources — the ClickUp connection, HQ's
// project pages and the small model — bound once at startup.
import type { Store } from '../persistence'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { listClickUpOwnerTasksUpdatedSince } from '../clickup/clickup-task-changes'
import { listHqProjectPages } from '../hq-project-pages/hq-project-pages'
import { runHqClickUpTriage, startHqClickUpTriage } from './hq-clickup-triage'
import { notifyHqSlackScoutChanged } from './hq-slack-scout'
import { generateHqText } from './hq-task-questions'

// Why: sorting a handful of edits is a small model's job; the HQ text model stays for writing.
const TRIAGE_MODEL = 'haiku'

export function registerHqClickUpTriage(store: Store, runtime: OrcaRuntimeService): void {
  startHqClickUpTriage({
    hqPath: () => store.getSettings().hqPath ?? null,
    enabled: () => store.getSettings().hqChatsView !== false,
    run: (hqPath) =>
      runHqClickUpTriage(hqPath, {
        listUpdated: listClickUpOwnerTasksUpdatedSince,
        projects: async () =>
          (await listHqProjectPages(hqPath).catch(() => [])).map((page) => ({
            slug: page.slug,
            about: page.title ?? page.slug
          })),
        generate: (prompt) =>
          generateHqText(
            prompt,
            {
              emptyResultName: 'triage verdicts',
              operation: 'hq-clickup-triage',
              model: TRIAGE_MODEL
            },
            {
              settings: store.getSettings(),
              cwd: hqPath,
              getAgentEnvResolvers: () => runtime.getCommitMessageAgentEnvironmentResolvers()
            }
          ),
        now: Date.now
      }),
    onAdded: notifyHqSlackScoutChanged
  })
}
