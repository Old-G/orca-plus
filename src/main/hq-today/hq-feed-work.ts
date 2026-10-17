// Custom build (hq-feed-posts): the feed's «done» rows — commits in the owner's projects, agent
// sessions that finished, and messages Approve actually let out to people.
import type { HqFeedItem } from '../../shared/hq-feed'
import { PULSE_BELL_KIND } from '../../shared/pulse-bell'
import type { PulseDecision, PulseDraft, PulseInboxItem } from '../../shared/pulse-types'
import { BODY_MAX, TITLE_MAX, clip, webUrl } from './hq-feed-fields'

export type HqFeedCommit = {
  project: string
  hash: string
  at: number
  author: string
  subject: string
}

// Why: fixups and merges are bookkeeping; the feature commit says what was done.
const BOOKKEEPING_COMMIT = /^(?:fixup!|squash!|amend!|wip\b|merge\b)/i
// Why: «ok», «готово» or a bare question say nothing about what was done.
const SESSION_SAID_MIN = 40
// Why: a ClickUp task created or a shell command approved is not a message a person reads.
const MESSAGE_DRAFT_KINDS = new Set<PulseDraft['kind']>(['message', 'clickup-comment'])
const LOG_FORMAT = '--format=%H%x1f%ct%x1f%an%x1f%s'

export const HQ_FEED_COMMIT_LOG_ARGS = [
  'log',
  '--branches',
  '--since=3.days',
  '--no-merges',
  '-n',
  '40',
  LOG_FORMAT
]

/** Recent commits of every project; a project git cannot read is skipped. */
export async function readHqFeedCommits(
  projects: readonly { path: string; name: string }[],
  log: (cwd: string) => Promise<string>
): Promise<HqFeedCommit[]> {
  const perProject = await Promise.all(
    projects.map(async (project) => {
      const text = await log(project.path).catch(() => '')
      return text.split('\n').flatMap((line): HqFeedCommit[] => {
        const [hash, seconds, author, subject] = line.split('\x1f')
        const at = Number(seconds) * 1000
        return hash && subject && Number.isFinite(at) && at > 0
          ? [{ project: project.name, hash, at, author: author ?? '', subject }]
          : []
      })
    })
  )
  return perProject.flat()
}

export function commitFeedItems(list: readonly HqFeedCommit[]): HqFeedItem[] {
  return list.flatMap((commit): HqFeedItem[] => {
    const subject = clip(commit.subject, TITLE_MAX)
    return subject && !BOOKKEEPING_COMMIT.test(subject)
      ? [
          {
            id: `commit:${commit.hash}`,
            source: 'git',
            kind: 'commit',
            at: commit.at,
            title: subject,
            body: null,
            url: null,
            project: clip(commit.project, 200),
            person: clip(commit.author, 200)
          }
        ]
      : []
  })
}

/** A finished agent turn: which session in which project, and the gist of what it said at the end. */
export function sessionFeedItems(items: readonly PulseInboxItem[]): HqFeedItem[] {
  return items.flatMap((item): HqFeedItem[] => {
    if (item.kind !== PULSE_BELL_KIND.agentFinished || !item.refId) {
      return []
    }
    let ref: unknown
    try {
      ref = JSON.parse(item.refId)
    } catch {
      return []
    }
    const field = (key: string): unknown =>
      ref && typeof ref === 'object' ? Reflect.get(ref, key) : undefined
    const said = clip(field('said'), BODY_MAX)
    const place = clip(field('place'), 200)
    if (!said || said.length < SESSION_SAID_MIN) {
      return []
    }
    return [
      {
        id: `session:${item.id}`,
        source: 'orca',
        kind: 'session',
        at: item.createdAt,
        title: clip(field('title'), TITLE_MAX) ?? place ?? 'Agent session',
        body: said,
        url: null,
        project: place ? (place.split(' / ')[0] ?? null) : null,
        person: clip(field('agent'), 200)
      }
    ]
  })
}

/** Approved messages to people that went out — not commands, not ones that never left. */
export function sentFeedItems(
  decisions: readonly PulseDecision[],
  drafts: readonly PulseDraft[]
): HqFeedItem[] {
  const delivered = new Map(
    drafts
      .filter((draft) => draft.status === 'sent' && MESSAGE_DRAFT_KINDS.has(draft.kind))
      .map((draft) => [draft.id, draft])
  )
  return decisions.flatMap((decision): HqFeedItem[] => {
    const draft = decision.draftId ? delivered.get(decision.draftId) : undefined
    const context = decision.sentContext
    if (
      decision.kind !== 'approval' ||
      (decision.outcome !== 'approved' && decision.outcome !== 'edited') ||
      !draft
    ) {
      return []
    }
    const service = context?.movedTo === 'clickup' ? 'ClickUp' : (context?.service ?? 'Slack')
    const to = context?.targetName ?? context?.taskName ?? draft.target
    return [
      {
        id: `orca:${decision.id}`,
        source: 'orca',
        kind: 'sent',
        at: decision.decidedAt,
        title: clip(to ? `${service} → ${to}` : service, TITLE_MAX) ?? 'Sent',
        body: clip(decision.body ?? draft.body, BODY_MAX),
        url: webUrl(context?.taskUrl),
        project: clip(context?.project ?? decision.project, 200),
        person: clip(context?.replyingTo, 200)
      }
    ]
  })
}
