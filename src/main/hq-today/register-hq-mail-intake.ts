// Custom build (hq-mail-intake): the mail intake's live sources — Gmail, ClickUp, GitLab through glab
// and the pulse waitings — bound once at startup, with Settings' Gmail IPC.
import type { Store } from '../persistence'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { getGmailMail, listGmailMessageIds } from '../gmail/gmail-api'
import { gmailAccount } from '../gmail/gmail-credential-store'
import {
  getClickUpTask,
  getClickUpViewer,
  listClickUpCommentReplies,
  listClickUpTaskComments
} from '../clickup/clickup-tasks'
import { glabExecFileAsync } from '../git/runner'
import { hqClickUpListProjects } from './hq-clickup-list-projects'
import { collectHqMailIntake, startHqMailIntake } from './hq-mail-intake'
import { notifyHqSlackScoutChanged } from './hq-slack-scout'
import { registerGmailHandlers } from '../ipc/gmail'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { HQ_MR_HOST, type HqMrRef, type HqMrState } from '../../shared/hq-mr-watch'
import {
  HQ_SLACK_SCOUT_CONFIG_FILE,
  HQ_SLACK_SCOUT_DIR,
  parseHqScoutConfigValues
} from '../../shared/hq-slack-scout'
import { createHqMrWatch, HQ_MR_WATCH_EVERY_MS } from './hq-mr-watch'
import { generateHqText } from './hq-task-questions'

async function glabJson(host: string, path: string): Promise<unknown> {
  const { stdout } = await glabExecFileAsync(['api', '--hostname', host, path])
  return JSON.parse(stdout)
}

function field(value: unknown, key: string): unknown {
  return value && typeof value === 'object' ? Reflect.get(value, key) : null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

function sameHost(url: string | null, host: string): string | null {
  try {
    return url && new URL(url).hostname.toLowerCase() === host ? url : null
  } catch {
    return null
  }
}

/** Custom build (hq-mr-watch): GitLab's word on one MR — its state, who merged and who approved it. */
async function gitLabMr(ref: HqMrRef): Promise<HqMrState | null> {
  if (ref.host !== HQ_MR_HOST) {
    return null
  }
  const base = `projects/${encodeURIComponent(ref.projectPath)}/merge_requests/${ref.iid}`
  const mr = await glabJson(ref.host, base)
  const state = text(field(mr, 'state'))
  if (!state) {
    return null
  }
  const approvals = await glabJson(ref.host, `${base}/approvals`).catch(() => null)
  const approvedBy = field(approvals, 'approved_by')
  return {
    state,
    title: text(field(mr, 'title')) ?? '',
    // Why: only a link back to the same host becomes the card's «Open in GitLab».
    url:
      sameHost(text(field(mr, 'web_url')), ref.host) ??
      `https://${ref.host}/${ref.projectPath}/-/merge_requests/${ref.iid}`,
    mergedBy: text(field(field(mr, 'merged_by'), 'name')),
    mergedAt: text(field(mr, 'merged_at')),
    closedAt: text(field(mr, 'closed_at')),
    approvedBy: Array.isArray(approvedBy)
      ? approvedBy.flatMap((entry) => text(field(field(entry, 'user'), 'name')) ?? [])
      : []
  }
}

/** The repos of the GitLab groups HQ's config names (`gitlab_groups`), cached for an hour. */
function gitLabRepos(hqPath: () => string | null): () => Promise<string[]> {
  let cached: { at: number; repos: string[] } | null = null
  return async () => {
    if (cached && Date.now() - cached.at < 60 * 60_000) {
      return cached.repos
    }
    const hq = hqPath()
    const config = hq
      ? await readFile(join(hq, HQ_SLACK_SCOUT_DIR, HQ_SLACK_SCOUT_CONFIG_FILE), 'utf8').catch(
          () => ''
        )
      : ''
    const groups = [
      ...(parseHqScoutConfigValues(config).get('gitlab_groups') ?? '').matchAll(/[\w./-]+/g)
    ].map((match) => match[0])
    const repos: string[] = []
    for (const group of groups) {
      const listed = await glabJson(
        HQ_MR_HOST,
        `groups/${encodeURIComponent(group)}/projects?per_page=100&include_subgroups=true&simple=true`
      ).catch((error: unknown) => {
        console.warn(`[hq-mr-watch] could not list the GitLab group ${group}:`, error)
        return []
      })
      for (const project of Array.isArray(listed) ? listed : []) {
        const path = text(field(project, 'path_with_namespace'))
        if (path) {
          repos.push(path)
        }
      }
    }
    // Why: an empty list (glab not on PATH yet at startup, GitLab down) is asked again next pass.
    cached = repos.length > 0 ? { at: Date.now(), repos } : null
    return repos
  }
}

export function registerHqMailIntake(store: Store, runtime: OrcaRuntimeService): void {
  registerGmailHandlers()
  // Custom build (hq-mr-watch): waitings that name an MR, checked against GitLab every few minutes.
  const hqPath = (): string | null => store.getSettings().hqPath ?? null
  const watch = createHqMrWatch({
    listOpen: () => runtime.pulseListWaitings({ status: 'open' }),
    listRepos: gitLabRepos(hqPath),
    getMr: gitLabMr,
    judge: async (prompt) => {
      const hq = hqPath()
      if (!hq) {
        return null
      }
      const result = await generateHqText(
        prompt,
        { emptyResultName: 'MR repo', operation: 'hq-mr-watch', model: 'haiku' },
        {
          settings: store.getSettings(),
          cwd: hq,
          getAgentEnvResolvers: () => runtime.getCommitMessageAgentEnvironmentResolvers()
        }
      )
      return result.ok ? result.text : null
    },
    recordReply: (id, reply) => runtime.pulseRecordWaitingReply(id, reply),
    setDetail: (id, detail) => void runtime.pulseUpdateWaiting(id, { detail }),
    now: Date.now
  })
  let running = false
  const kickMrWatch = (): void => {
    if (running || !hqPath() || store.getSettings().hqChatsView === false) {
      return
    }
    running = true
    void watch
      .poll()
      .then((answered) =>
        console.log(`[hq-mr-watch] ${watch.watched()} waiting(s) name an MR, ${answered} answered`)
      )
      .catch((error: unknown) => console.warn('[hq-mr-watch] check failed:', error))
      .finally(() => {
        running = false
      })
  }
  setTimeout(kickMrWatch, 60_000)
  setInterval(kickMrWatch, HQ_MR_WATCH_EVERY_MS)
  startHqMailIntake({
    hqPath: () => store.getSettings().hqPath ?? null,
    enabled: () => store.getSettings().hqChatsView !== false && gmailAccount() !== null,
    collect: async (hq) =>
      collectHqMailIntake(hq, {
        listMailIds: listGmailMessageIds,
        getMail: getGmailMail,
        getTask: getClickUpTask,
        listComments: listClickUpTaskComments,
        listReplies: listClickUpCommentReplies,
        viewer: getClickUpViewer,
        projectForList: await hqClickUpListProjects(
          hq,
          store.getSettings().hqProjectClickUpLists ?? {}
        ),
        mrMerged: () => kickMrWatch(),
        now: Date.now
      }),
    onAdded: notifyHqSlackScoutChanged
  })
}
