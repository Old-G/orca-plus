// Custom build (hq-plus-ui-v2): one badge format for every kind of row — mono capitals, the kind's
// colour — so the same mark finds a row in the left column and its card in the feed.
import type { HqPlusBadge as Badge } from '../../../../../shared/hq-plus-kinds'

export function HqPlusBadges({ badges }: { badges: readonly Badge[] }): React.JSX.Element | null {
  if (badges.length === 0) {
    return null
  }
  return (
    <span className="hqp-badges">
      {badges.map((badge) => (
        <span key={badge.label} className="hqp-badge" data-tone={badge.tone}>
          {badge.label}
        </span>
      ))}
    </span>
  )
}
