// Custom build (hq-plus-map): Feed | Map beside the rooms — Feed is HQ+'s current layout, Map the room's
// map (owner, 31.10: one switch, not two) — and the Map layout's crumb line: where the owner is, each step
// but the last a way back.
import { translate } from '@/i18n/i18n'

export type HqPlusMapCrumb = { id: string; label: string; go: (() => void) | null }

export function HqPlusMapCrumbs({
  crumbs,
  esc
}: {
  crumbs: readonly HqPlusMapCrumb[]
  /** What Esc closes now; null when nothing is open. */
  esc: string | null
}): React.JSX.Element {
  return (
    <nav className="hqm-crumbs" aria-label="Where you are">
      {crumbs.map((crumb, index) => {
        const last = index === crumbs.length - 1
        return (
          <span key={crumb.id} className="hqm-crumb">
            {last || !crumb.go ? (
              <span className={last ? 'cur' : ''}>{crumb.label}</span>
            ) : (
              <button type="button" onClick={crumb.go}>
                {crumb.label}
              </button>
            )}
            {last ? null : <span aria-hidden="true">›</span>}
          </span>
        )
      })}
      {esc ? <span className="hqm-esc">ESC closes {esc}</span> : null}
    </nav>
  )
}

export function HqPlusLayoutSwitch({
  layout,
  onLayout
}: {
  layout: 'current' | 'map'
  onLayout: (layout: 'current' | 'map') => void
}): React.JSX.Element {
  return (
    <div className="hqm-seg hqm-layout" role="group" aria-label="Feed or Map">
      {(['current', 'map'] as const).map((name) => (
        <button
          key={name}
          type="button"
          aria-pressed={layout === name}
          title={
            name === 'map'
              ? translate(
                  'auto.hqPlus.layout.mapTip',
                  'The room as a map: sources, projects, people'
                )
              : translate('auto.hqPlus.layout.feedTip', 'The feed and the chats')
          }
          onClick={() => onLayout(name)}
        >
          {name === 'map'
            ? translate('auto.hqPlus.layout.map', 'Map')
            : translate('auto.hqPlus.layout.feed', 'Feed')}
        </button>
      ))}
    </div>
  )
}
