// Custom build (hq-mail-intake): the mail intake's live sources — Gmail, ClickUp, GitLab through glab
// and the pulse waitings — bound once at startup, with Settings' Gmail IPC.
import type { Store } from '../persistence/loading-store/store'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import {
  getGmailLetter,
  getGmailMail,
  listGmailMessageIds,
  listGmailMessageRefs
} from '../gmail/gmail-api'
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
import { createHqGitLabRepos } from './hq-gitlab-repos'
import { createHqMrWatch, HQ_MR_WATCH_EVERY_MS } from './hq-mr-watch'
import { generateHqText } from './hq-task-questions'
import { listHqProjectPages } from '../hq-project-pages/hq-project-pages'
import { guessHqLedger, type HqLedgerGuessInput } from './hq-ledger-guess'
import { hqLedgerErrorReporter } from './hq-ledger-errors'
import { HQ_GITLAB_TODO_READER, startHqGitLabTodoReader } from './hq-gitlab-todo-reader'
import { hqMrChatOfBranch } from './hq-mr-chat'
import { startHqMailLedgerReader } from './hq-mail-ledger-reader'
import type { HqLedgerGuess } from '../orca-plus/pulse/pulse-ledger'
import { noteHqClickUpWatchedTask } from './hq-clickup-ledger-reader'
import { registerHqClickUpLedger } from './register-hq-clickup-ledger'

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

// Why: a new conversation's project is a small judgement, as for the Slack reader.
const GUESS_MODEL = 'haiku'

/** Custom build (hq-ledger-sources): the small model's read of a new conversation from GitLab or mail. */
function ledgerGuess(
  store: Store,
  runtime: OrcaRuntimeService,
  input: HqLedgerGuessInput
): Promise<HqLedgerGuess | null> {
  const hq = store.getSettings().hqPath
  if (!hq) {
    return Promise.resolve(null)
  }
  return guessHqLedger(input, {
    pages: () => listHqProjectPages(hq),
    authorProjects: () => [],
    generate: (prompt) =>
      generateHqText(
        prompt,
        { emptyResultName: 'ledger guess', operation: 'hq-ledger-guess', model: GUESS_MODEL },
        {
          settings: store.getSettings(),
          cwd: hq,
          getAgentEnvResolvers: () => runtime.getCommitMessageAgentEnvironmentResolvers()
        }
      )
  })
}

/** Custom build (hq-ledger-sources): the owner's GitLab To-Do list into the request ledger. */
function registerGitLabTodos(
  store: Store,
  runtime: OrcaRuntimeService,
  readConfig: () => Promise<string>
): void {
  let owner: string | null = null
  startHqGitLabTodoReader(
    {
      enabled: () => store.getSettings().hqLedger !== 'off',
      listPending: (page) =>
        glabJson(
          HQ_MR_HOST,
          `todos?state=pending&type=MergeRequest&per_page=100&page=${String(page)}`
        ),
      owner: async () => {
        if (!owner) {
          const user = await glabJson(HQ_MR_HOST, 'user')
          const username = text(field(user, 'username'))
          if (!username) {
            throw new Error('GitLab did not say whose to-dos these are')
          }
          owner = username
        }
        return owner
      },
      // Why a knob: GitLab marks only its own bots; a service account made as a user (31.10: the
      // hub's MCP account) is named in HQ's config, `gitlab_bots: [acme-mcp]`.
      bots: async () =>
        [
          ...(parseHqScoutConfigValues(await readConfig()).get('gitlab_bots') ?? '').matchAll(
            /[\w.-]+/g
          )
        ].map((match) => match[0]),
      projects: async () => {
        const hq = store.getSettings().hqPath
        return hq ? (await listHqProjectPages(hq)).map((page) => page.slug) : []
      },
      ingest: (signal) => runtime.pulseIngestLedger(signal),
      lastDirection: (key) => runtime.pulseLastLedgerDirection(key),
      openKeys: () => runtime.pulseListLedgerOpenKeys(HQ_GITLAB_TODO_READER),
      close: (key) => void runtime.pulseCloseLedgerConversation(key),
      guess: (todo) =>
        ledgerGuess(store, runtime, {
          author: todo.authorName,
          fromOwner: false,
          dm: false,
          where: 'a GitLab merge request',
          text: [todo.repo, todo.targetTitle, todo.body].filter(Boolean).join('\n'),
          links: [todo.targetUrl]
        }),
      setGuess: (id, guess) => runtime.pulseSetLedgerGuess(id, guess),
      chatOfBranch: hqMrChatOfBranch(store, runtime),
      setChat: (key, sessionId) => runtime.pulseSetConversationChat(key, sessionId),
      now: Date.now
    },
    hqLedgerErrorReporter('hq-gitlab-todos', 'GitLab To-Do list not read', (rows) =>
      runtime.pulseRecordJournal(rows)
    )
  )
}

/** Custom build (hq-ledger-sources): letters from people (the intake reads only notices) into the ledger. */
function registerMailLetters(store: Store, runtime: OrcaRuntimeService): void {
  startHqMailLedgerReader(
    {
      enabled: () => store.getSettings().hqLedger !== 'off' && gmailAccount() !== null,
      owner: gmailAccount,
      listRefs: listGmailMessageRefs,
      getLetter: getGmailLetter,
      ingest: (signal) => runtime.pulseIngestLedger(signal),
      lastDirection: (key) => runtime.pulseLastLedgerDirection(key),
      guess: (letter, signal) =>
        ledgerGuess(store, runtime, {
          author: signal.author,
          fromOwner: false,
          dm: signal.forOwner,
          where: signal.forOwner ? 'an email to the user' : 'an email the user is copied on',
          text: `Subject: ${letter.subject}\n\n${signal.text}`,
          links: []
        }),
      setGuess: (id, guess) => runtime.pulseSetLedgerGuess(id, guess),
      now: Date.now
    },
    hqLedgerErrorReporter('hq-mail-ledger', 'Letters from people not read', (rows) =>
      runtime.pulseRecordJournal(rows)
    )
  )
}

export function registerHqMailIntake(store: Store, runtime: OrcaRuntimeService): void {
  registerGmailHandlers()
  // Custom build (hq-clickup-ledger, plan 20.4): ClickUp comments straight into the request ledger,
  // on his tasks and on those this mail names.
  registerHqClickUpLedger(store, runtime)
  // Custom build (hq-mr-watch): waitings that name an MR, checked against GitLab every few minutes.
  const hqPath = (): string | null => store.getSettings().hqPath ?? null
  const readConfig = async (): Promise<string> => {
    const hq = hqPath()
    return hq
      ? readFile(join(hq, HQ_SLACK_SCOUT_DIR, HQ_SLACK_SCOUT_CONFIG_FILE), 'utf8').catch(() => '')
      : ''
  }
  const watch = createHqMrWatch({
    listOpen: () => runtime.pulseListWaitings({ status: 'open' }),
    listRepos: createHqGitLabRepos({
      readConfig,
      glabJson: (path) => glabJson(HQ_MR_HOST, path),
      now: Date.now,
      warn: (message, error) => console.warn(message, error)
    }),
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
  registerGitLabTodos(store, runtime, readConfig)
  startHqMailIntake({
    hqPath: () => store.getSettings().hqPath ?? null,
    enabled: () => store.getSettings().hqChatsView !== false && gmailAccount() !== null,
    collect: async (hq) =>
      collectHqMailIntake(hq, {
        listMailIds: listGmailMessageIds,
        getMail: getGmailMail,
        // Custom build (hq-clickup-ledger): a task ClickUp mailed about is read into the ledger too.
        getTask: (ref) => {
          noteHqClickUpWatchedTask(ref, Date.now())
          return getClickUpTask(ref)
        },
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
  registerMailLetters(store, runtime)
}
