// Custom build (hq-plus-map): the switch between HQ+'s current layout and the Map layout, and the Map
// layout's crumb line — where the owner is, each step but the last a way back.
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
    <div className="hqm-seg hqm-layout" role="group" aria-label="HQ+ layout">
      {(['current', 'map'] as const).map((name) => (
        <button
          key={name}
          type="button"
          aria-pressed={layout === name}
          title={
            name === 'map'
              ? translate('auto.hqPlus.layout.mapTip', 'New layout: Map and the feed by tabs')
              : translate('auto.hqPlus.layout.currentTip', 'The current layout')
          }
          onClick={() => onLayout(name)}
        >
          {name === 'map'
            ? translate('auto.hqPlus.layout.map', 'Map')
            : translate('auto.hqPlus.layout.current', 'Current')}
        </button>
      ))}
    </div>
  )
}
