// Custom build (hq-chats): a project's accent color — the badge color picked for it, else a palette
// color chosen by its id, so projects left on the neutral default still tell apart.
import { DEFAULT_REPO_BADGE_COLOR, REPO_COLORS } from './constants'

const ACCENTS = REPO_COLORS.filter((color) => color !== DEFAULT_REPO_BADGE_COLOR)

function stableIndex(id: string, size: number): number {
  let hash = 5381
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 33 + id.charCodeAt(index)) >>> 0
  }
  return hash % size
}

export function projectAccentColor(projectId: string, badgeColor?: string | null): string {
  if (badgeColor && badgeColor.toLowerCase() !== DEFAULT_REPO_BADGE_COLOR) {
    return badgeColor
  }
  return ACCENTS[stableIndex(projectId, ACCENTS.length)]
}
