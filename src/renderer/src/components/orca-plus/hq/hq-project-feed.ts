// Custom build (hq): a project card's feed — its recent commits and the decisions recorded for it,
// as one newest-first timeline.
import type { GitHistoryItem } from '../../../../../shared/git-history-types'
import type { HqDecision } from './hq-pulse-snapshot'

export type HqFeedEntry =
  | { kind: 'commit'; id: string; at: number; title: string; hash: string; author: string | null }
  | { kind: 'decision'; id: string; at: number; title: string; decision: HqDecision }

export function buildHqProjectFeed(
  commits: readonly GitHistoryItem[],
  decisions: readonly HqDecision[],
  slug: string | null,
  limit: number
): HqFeedEntry[] {
  const entries: HqFeedEntry[] = [
    // Why: a commit with no author time cannot be placed on the timeline.
    ...commits.flatMap((commit): HqFeedEntry[] =>
      commit.timestamp === undefined
        ? []
        : [
            {
              kind: 'commit',
              id: `commit:${commit.id}`,
              at: commit.timestamp,
              title: commit.subject,
              hash: commit.displayId ?? commit.id.slice(0, 7),
              author: commit.author ?? null
            }
          ]
    ),
    ...(slug
      ? decisions.flatMap((decision): HqFeedEntry[] =>
          decision.project === slug
            ? [
                {
                  kind: 'decision',
                  id: `decision:${decision.id}`,
                  at: decision.decidedAt,
                  title: decision.title,
                  decision
                }
              ]
            : []
        )
      : [])
  ]
  return entries.sort((a, b) => b.at - a.at).slice(0, limit)
}
