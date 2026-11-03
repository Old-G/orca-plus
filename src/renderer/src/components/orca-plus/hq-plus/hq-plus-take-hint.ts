// Custom build (hq-plus-take-hint, owner 02.11): the project and chat a card showed when «To work» was
// pressed, so the picker on the right opens on them instead of on nothing — the request itself (a
// Slack or ClickUp message) often names no project; the card's conversation does.
export type HqPlusTakeHint = {
  project: string | null
  sessionId: string | null
  /** Custom build (hq-attribution-log): the conversation the card stood for, when it knew one. */
  key?: string | null
  /** Custom build (hq-intake-decide): what the model proposed for it — kind, certainty, why. */
  guess?: { kind: string | null; confidence: number | null; why: string | null } | null
}

const MAX_HINTS = 50
const hints = new Map<string, HqPlusTakeHint>()

/** Remembers where a card sat; a field the card does not know keeps what an inner card said. */
export function noteHqPlusTakeHint(itemId: string, hint: HqPlusTakeHint): void {
  const known = hints.get(itemId)
  hints.delete(itemId)
  hints.set(itemId, {
    project: hint.project ?? known?.project ?? null,
    sessionId: hint.sessionId ?? known?.sessionId ?? null,
    key: hint.key ?? known?.key ?? null,
    guess: hint.guess ?? known?.guess ?? null
  })
  if (hints.size > MAX_HINTS) {
    hints.delete(hints.keys().next().value ?? '')
  }
}

export function hqPlusTakeHint(itemId: string): HqPlusTakeHint | null {
  return hints.get(itemId) ?? null
}

/** The repo a card's project names: an HQ page slug, else the project's name in Orca. */
export function hqPlusTakeHintRepo(
  project: string | null,
  pages: readonly { slug: string; repoId: string | null }[],
  repos: readonly { id: string; displayName: string }[]
): string | null {
  if (!project) {
    return null
  }
  return (
    pages.find((page) => page.slug === project)?.repoId ??
    repos.find((repo) => repo.displayName === project)?.id ??
    null
  )
}
