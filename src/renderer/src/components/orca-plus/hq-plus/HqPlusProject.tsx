// Custom build (hq-plus-ui-v3): a chat's project inside HQ+ — its files, source control and checks in the
// right panel, the same panels the Code view shows, without leaving HQ+.
import { Suspense, useEffect, useRef, useState } from 'react'
import { lazyWithRetry as lazy } from '@/lib/lazy-with-retry'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { RightSidebarPanelContent } from '../../right-sidebar/right-sidebar-panel-content'
import type { ExecutionHostId } from '../../../../../shared/execution-host'
import type { HqChatItem } from '../hq/hq-chat-list'

const EditorPanel = lazy(() => import('../../editor/EditorPanel'))

const VIEWS = [
  ['explorer', 'auto.hqPlus.project.files', 'Files'],
  ['source-control', 'auto.hqPlus.project.sourceControl', 'Source control'],
  ['checks', 'auto.hqPlus.project.checks', 'Checks']
] as const

type View = (typeof VIEWS)[number][0]

function executionHostOf(item: HqChatItem): ExecutionHostId | undefined {
  return item.kind === 'terminal'
    ? item.card.executionHostId
    : (item.tab.executionHostId ?? item.card?.executionHostId)
}

export function HqPlusProject({
  item,
  onBack
}: {
  item: HqChatItem
  onBack: () => void
}): React.JSX.Element {
  const [view, setView] = useState<View>('explorer')
  const [fileOpen, setFileOpen] = useState(false)
  const activeWorktreeId = useAppStore((state) => state.activeWorktreeId)
  const activeFileId = useAppStore((state) => state.activeFileId)
  const fileAtStart = useRef(activeFileId)

  // Why: the explorer, source control and checks read the active workspace; making the chat's
  // workspace active keeps the view on HQ+ (only a reveal switches to Code).
  useEffect(() => {
    if (useAppStore.getState().activeWorktreeId !== item.worktreeId) {
      useAppStore.getState().setActiveWorktree(item.worktreeId, executionHostOf(item))
    }
  }, [item])

  // A file clicked in the tree opens here, in the panel, instead of a Code-view tab.
  useEffect(() => {
    if (activeFileId && activeFileId !== fileAtStart.current) {
      fileAtStart.current = activeFileId
      setFileOpen(true)
    }
  }, [activeFileId])

  const ready = activeWorktreeId === item.worktreeId
  return (
    <div className="hqp-chat hqp-proj flex h-full min-h-0 flex-col">
      <div className="hqp-ses-h">
        <button
          type="button"
          className="hqp-pill"
          onClick={fileOpen ? () => setFileOpen(false) : onBack}
        >
          ←{' '}
          {fileOpen
            ? translate('auto.hqPlus.project.backFiles', 'Files')
            : translate('auto.hqPlus.project.backChat', 'Chat')}
        </button>
        <span className="t" title={item.worktreeName}>
          {item.projectName}
        </span>
      </div>
      {fileOpen ? null : (
        <div className="hqp-tabs" role="tablist">
          {VIEWS.map(([key, labelKey, fallback]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={view === key}
              className="hqp-tab"
              onClick={() => setView(key)}
            >
              {translate(labelKey, fallback)}
            </button>
          ))}
        </div>
      )}
      <div className="hqp-proj-body">
        {!ready ? (
          <p className="hqp-empty">{translate('auto.hqPlus.project.opening', 'Opening…')}</p>
        ) : fileOpen ? (
          <Suspense fallback={null}>
            <EditorPanel />
          </Suspense>
        ) : (
          <RightSidebarPanelContent effectiveTab={view} rightSidebarOpen />
        )}
      </div>
    </div>
  )
}
