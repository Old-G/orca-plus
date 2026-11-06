// Custom build (hq-plus-map): Feed | Map beside the rooms — Feed is HQ+'s current layout, Map the room's
// map (owner, 31.10: one switch, not two) — and the Map layout's crumb line: where the owner is, each step
// but the last a way back.
import { translate } from '@/i18n/i18n'
import type { HqPlusLayout } from './hq-plus-layout'

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

const LAYOUTS: readonly HqPlusLayout[] = ['current', 'map', 'work']

function labelOf(name: HqPlusLayout): { label: string; tip: string } {
  switch (name) {
    case 'map':
      return {
        label: translate('auto.hqPlus.layout.map', 'Map'),
        tip: translate('auto.hqPlus.layout.mapTip', 'The room as a map: sources, projects, people')
      }
    case 'work':
      return {
        label: translate('auto.hqPlus.layout.work', 'Work'),
        tip: translate(
          'auto.hqPlus.layout.workTip',
          'Each lead chat with the chats it started, and what needs you'
        )
      }
    default:
      return {
        label: translate('auto.hqPlus.layout.feed', 'Feed'),
        tip: translate('auto.hqPlus.layout.feedTip', 'The feed and the chats')
      }
  }
}

export function HqPlusLayoutSwitch({
  layout,
  onLayout
}: {
  layout: HqPlusLayout
  onLayout: (layout: HqPlusLayout) => void
}): React.JSX.Element {
  // Custom build (hq-plus-work-view, owner 06.11): Feed | Map | Work — one switch.
  return (
    <div className="hqm-seg hqm-layout" role="group" aria-label="Feed, Map or Work">
      {LAYOUTS.map((name) => {
        const { label, tip } = labelOf(name)
        return (
          <button
            key={name}
            type="button"
            aria-pressed={layout === name}
            title={tip}
            onClick={() => onLayout(name)}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}
