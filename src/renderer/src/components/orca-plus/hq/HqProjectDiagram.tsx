// Custom build (hq): a project card's map — the project's own Strata diagram, loaded on request
// because an Archify page is large.
import { useEffect, useState } from 'react'
import type { HqProjectDiagramResult } from '../../../../../shared/hq-project-pages'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'

type DiagramState = { status: 'idle' } | { status: 'loading' } | HqProjectDiagramResult

function problemText(state: Exclude<HqProjectDiagramResult, { ok: true }>): string {
  switch (state.reason) {
    case 'none':
      return translate(
        'auto.hq.project.noDiagram',
        'This project has no Strata diagram yet (wiki/diagrams/).'
      )
    case 'remote':
      return translate(
        'auto.hq.project.remoteDiagram',
        'This project lives on another host; its diagram can only be read there.'
      )
    case 'failed':
      return translate('auto.hq.project.diagramFailed', "Couldn't read the diagram: {{value0}}", {
        value0: state.error ?? ''
      })
  }
}

export function HqProjectDiagram({ repoId }: { repoId: string }): React.JSX.Element {
  const [loaded, setLoaded] = useState<{ repoId: string; state: DiagramState } | null>(null)
  const state: DiagramState = loaded?.repoId === repoId ? loaded.state : { status: 'idle' }
  const requested = 'status' in state && state.status === 'loading'
  useEffect(() => {
    if (!requested) {
      return
    }
    let alive = true
    window.api.hqProjects
      .projectDiagram(repoId)
      .catch((error: unknown): HqProjectDiagramResult => ({
        ok: false,
        reason: 'failed',
        error: String(error)
      }))
      .then((result) => {
        if (alive) {
          setLoaded({ repoId, state: result })
        }
      })
    return () => {
      alive = false
    }
  }, [repoId, requested])

  const title = translate('auto.hq.project.map', 'Map')
  return (
    <section className="flex flex-col gap-2" aria-label={title}>
      <div className="flex items-center gap-2">
        <h2 className="flex-1 text-[11px] font-semibold tracking-[0.05em] text-muted-foreground uppercase">
          {title}
          {'ok' in state && state.ok ? (
            <span className="ml-2 font-mono font-normal tracking-normal normal-case">
              {state.name}
            </span>
          ) : null}
        </h2>
        {'status' in state && state.status === 'idle' ? (
          <Button
            type="button"
            variant="secondary"
            size="xs"
            onClick={() => setLoaded({ repoId, state: { status: 'loading' } })}
          >
            {translate('auto.hq.project.showMap', 'Show the map')}
          </Button>
        ) : null}
      </div>
      {'status' in state ? (
        state.status === 'loading' ? (
          <p className="text-xs text-muted-foreground">
            {translate('auto.hq.waiting.loading', 'Loading…')}
          </p>
        ) : null
      ) : state.ok ? (
        <iframe
          title={title}
          // SECURITY: Archify's own viewer script runs; no allow-same-origin, so it cannot reach Orca.
          sandbox="allow-scripts allow-downloads"
          referrerPolicy="no-referrer"
          srcDoc={state.html}
          className="h-[560px] w-full rounded-lg border border-border"
        />
      ) : (
        <p className="text-xs text-muted-foreground">{problemText(state)}</p>
      )}
    </section>
  )
}
