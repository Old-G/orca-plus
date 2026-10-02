// Custom build (hq): the HQ «Map» tab — every project and its relations, drawn by Archify from HQ's
// project pages. Main keeps wiki/diagrams/projects.* current; this tab only shows the result.
import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import type { HqProjectMapResult } from '../../../../../shared/hq-project-pages'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'

type MapState = { status: 'loading' } | HqProjectMapResult

function problemText(state: Exclude<HqProjectMapResult, { ok: true }>): string {
  switch (state.reason) {
    case 'off':
      return translate('auto.hq.map.off', 'Set an HQ folder in Settings to draw the project map.')
    case 'archify-missing':
      return translate(
        'auto.hq.map.archifyMissing',
        'The map is drawn by Archify. Install it with: npx skills add tt-a1i/archify -g'
      )
    case 'failed':
      return translate('auto.hq.map.failed', "Couldn't draw the map: {{value0}}", {
        value0: state.error ?? ''
      })
  }
}

export function HqMapTab(): React.JSX.Element {
  const [state, setState] = useState<MapState>({ status: 'loading' })
  const load = useCallback((): (() => void) => {
    let alive = true
    window.api.hqProjects
      .map()
      .then((result) => {
        if (alive) {
          setState(result)
        }
      })
      .catch((error: unknown) => {
        if (alive) {
          setState({ ok: false, reason: 'failed', error: String(error) })
        }
      })
    return () => {
      alive = false
    }
  }, [])
  useEffect(() => load(), [load])

  if ('status' in state) {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        {translate('auto.hq.map.loading', 'Drawing the project map…')}
      </p>
    )
  }
  if (!state.ok) {
    return <p className="p-4 text-sm text-muted-foreground">{problemText(state)}</p>
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-1.5 text-xs text-muted-foreground">
        <span className="flex-1">
          {translate('auto.hq.map.summary', '{{value0}} projects · {{value1}} relations', {
            value0: String(state.projects),
            value1: String(state.relations)
          })}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={() => {
            setState({ status: 'loading' })
            load()
          }}
        >
          <RefreshCw />
          {translate('auto.hq.map.refresh', 'Refresh')}
        </Button>
      </div>
      <iframe
        title={translate('auto.hq.map.title', 'Project map')}
        // SECURITY: Archify's own viewer script runs; no allow-same-origin, so it cannot reach Orca.
        sandbox="allow-scripts allow-downloads"
        referrerPolicy="no-referrer"
        srcDoc={state.html}
        className="min-h-0 w-full flex-1 border-0"
      />
    </div>
  )
}
