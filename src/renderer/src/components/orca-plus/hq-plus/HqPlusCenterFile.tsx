// Custom build (hq-plus-center-file): a file opened from HQ+ takes the center column over the feed, in
// Orca's own editor — edits, saves and tabs work as in Code; «Feed» brings the feed back as it was.
import { Suspense } from 'react'
import { lazyWithRetry as lazy } from '@/lib/lazy-with-retry'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'

const EditorPanel = lazy(() => import('../../editor/EditorPanel'))

export function HqPlusCenterFile({ onClose }: { onClose: () => void }): React.JSX.Element {
  const path = useAppStore(
    (state) => state.openFiles.find((file) => file.id === state.activeFileId)?.relativePath ?? null
  )
  return (
    <section
      className="hqp-center-file"
      aria-label={translate('auto.hqPlus.centerFile', 'Open file')}
    >
      <div className="hqp-fh">
        <button type="button" className="hqp-pill" onClick={onClose}>
          ← {translate('auto.hqPlus.centerFile.back', 'Feed')}
        </button>
        {path ? <span className="hqp-mono">{path}</span> : null}
      </div>
      <div className="hqp-center-file-body">
        <Suspense fallback={null}>
          <EditorPanel />
        </Suspense>
      </div>
    </section>
  )
}
