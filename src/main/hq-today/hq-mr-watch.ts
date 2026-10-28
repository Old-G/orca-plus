// Custom build (hq-mr-watch): every few minutes, and at once when GitLab mails that an MR was merged,
// each open waiting that names an MR is checked against GitLab. A merge (or the approval it waits for)
// becomes the waiting's answer from «GitLab» — the usual answer card, passed to the chat only by the
// owner's click. While nothing happened, the waiting's «Checked» line says what GitLab sees.
import {
  HQ_GITLAB_AUTHOR,
  HQ_GITLAB_AUTHOR_ID,
  hqMrIntent,
  hqMrMentions,
  hqMrOutcome,
  hqMrRepoByName,
  hqMrRepoPrompt,
  parseHqMrRepo,
  type HqMrRef,
  type HqMrState
} from '../../shared/hq-mr-watch'
import { hqWaitingDay, readHqWaitingTags, withHqWaitingTag } from '../../shared/hq-waiting-tags'
import { slackTsAt } from '../../shared/hq-waiting-replies'
import type { PulseWaiting, PulseWaitingReply } from '../../shared/pulse-types'

export const HQ_MR_WATCH_EVERY_MS = 5 * 60_000
const GITLAB_HOST = 'gitlab.com'

export type HqMrWatchDeps = {
  listOpen: () => PulseWaiting[]
  /** `group/repo` paths of the GitLab groups HQ follows. */
  listRepos: () => Promise<string[]>
  getMr: (ref: HqMrRef) => Promise<HqMrState | null>
  /** The small model's text; null when it could not be asked. */
  judge: (prompt: string) => Promise<string | null>
  recordReply: (id: string, reply: PulseWaitingReply) => PulseWaiting | null
  setDetail: (id: string, detail: string | null) => void
  now: () => number
}

export type HqMrWatch = {
  /** Checks every waiting that names an MR; returns how many got their answer. */
  poll: () => Promise<number>
  /** How many waitings name an MR GitLab is asked about. */
  watched: () => number
}

/** A waiting the watch may answer: open, on someone else, no unread answer it would overwrite. */
function watchable(waiting: PulseWaiting): boolean {
  return (
    waiting.direction === 'on-them' &&
    waiting.status === 'open' &&
    waiting.replyAuthorId !== HQ_GITLAB_AUTHOR_ID &&
    (waiting.replyTs === null || waiting.replyDeliveredAt !== null)
  )
}

export function createHqMrWatch(deps: HqMrWatchDeps): HqMrWatch {
  // Why: one model call per project per run of Orca+, NONE included.
  const repoOfProject = new Map<string, string | null>()
  let watchedCount = 0

  const repoFor = async (project: string | null, sample: string): Promise<string | null> => {
    if (!project) {
      return null
    }
    if (repoOfProject.has(project)) {
      return repoOfProject.get(project) ?? null
    }
    const repos = await deps.listRepos()
    const byName = hqMrRepoByName(project, repos)
    const repo =
      byName ??
      (repos.length > 0
        ? parseHqMrRepo((await deps.judge(hqMrRepoPrompt(project, sample, repos))) ?? '', repos)
        : null)
    repoOfProject.set(project, repo)
    return repo
  }

  const refsOf = async (waiting: PulseWaiting): Promise<HqMrRef[]> => {
    const text = [waiting.title, readHqWaitingTags(waiting.detail).text, waiting.sourceRef]
      .filter(Boolean)
      .join('\n')
    const { refs, bare } = hqMrMentions(text)
    if (bare.length === 0) {
      return refs
    }
    const repo = await repoFor(waiting.project, waiting.title)
    return repo
      ? [...refs, ...bare.map((iid) => ({ host: GITLAB_HOST, projectPath: repo, iid }))]
      : refs
  }

  return {
    watched: () => watchedCount,
    async poll() {
      let answered = 0
      let watched = 0
      for (const waiting of deps.listOpen().filter(watchable)) {
        const refs = await refsOf(waiting).catch(() => [])
        if (refs.length === 0) {
          continue
        }
        watched += 1
        const intent = hqMrIntent(waiting.title)
        const statuses: string[] = []
        for (const ref of refs) {
          const mr = await deps.getMr(ref).catch(() => null)
          if (!mr) {
            continue
          }
          const outcome = hqMrOutcome(ref, mr, intent, deps.now())
          if (outcome.done) {
            const recorded = deps.recordReply(waiting.id, {
              text: `${HQ_GITLAB_AUTHOR}: ${outcome.text}`,
              author: HQ_GITLAB_AUTHOR,
              ts: slackTsAt(outcome.at),
              link: mr.url,
              authorId: HQ_GITLAB_AUTHOR_ID
            })
            if (recorded) {
              answered += 1
            }
            statuses.length = 0
            break
          }
          statuses.push(outcome.status)
        }
        // Why: the line changes only when GitLab's answer does, so the waiting is not rewritten each pass.
        const status = statuses.join('; ')
        const checked = readHqWaitingTags(waiting.detail).checked ?? ''
        if (status && !checked.endsWith(`— ${status}`)) {
          deps.setDetail(
            waiting.id,
            withHqWaitingTag(
              waiting.detail,
              'checked',
              `${hqWaitingDay(deps.now())} ${new Date(deps.now()).toTimeString().slice(0, 5)} — ${status}`
            )
          )
        }
      }
      watchedCount = watched
      return answered
    }
  }
}
