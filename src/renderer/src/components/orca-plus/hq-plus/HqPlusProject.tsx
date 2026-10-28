// Custom build (hq-plus-ui-v3): a chat's project inside HQ+ — its files, source control and checks in the
// right panel, the same panels the Code view shows, without leaving HQ+.
// Custom build (hq-plus-center-file): a file clicked in the tree opens in HQ+'s center, not in the panel.
import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { RightSidebarPanelContent } from '../../right-sidebar/right-sidebar-panel-content'
import type { ExecutionHostId } from '../../../../../shared/execution-host'
import type { HqChatItem } from '../hq/hq-chat-list'
import { openHqPlusCenterFile } from './hq-plus-center-file'

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
  const activeWorktreeId = useAppStore((state) => state.activeWorktreeId)
  const activeFileId = useAppStore((state) => state.activeFileId)
  const ready = activeWorktreeId === item.worktreeId
  // Why: the workspace switch restores its own last file; only a file opened after it counts.
  const fileAtStart = useRef<string | null | undefined>(undefined)

  // Why: the explorer, source control and checks read the active workspace; making the chat's
  // workspace active keeps the view on HQ+ (only a reveal switches to Code).
  useEffect(() => {
    if (useAppStore.getState().activeWorktreeId !== item.worktreeId) {
      useAppStore.getState().setActiveWorktree(item.worktreeId, executionHostOf(item))
    }
  }, [item])

  // A file clicked in the tree opens in HQ+'s center instead of a Code-view tab.
  useEffect(() => {
    if (!ready) {
      fileAtStart.current = undefined
      return
    }
    if (fileAtStart.current === undefined) {
      fileAtStart.current = activeFileId
      return
    }
    if (activeFileId && activeFileId !== fileAtStart.current) {
      fileAtStart.current = activeFileId
      openHqPlusCenterFile(item.worktreeId)
    }
  }, [activeFileId, ready, item.worktreeId])

  return (
    <div className="hqp-chat hqp-proj flex h-full min-h-0 flex-col">
      <div className="hqp-ses-h">
        <button type="button" className="hqp-pill" onClick={onBack}>
          ← {translate('auto.hqPlus.project.backChat', 'Chat')}
        </button>
        <span className="t" title={item.worktreeName}>
          {item.projectName}
        </span>
      </div>
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
      <div className="hqp-proj-body">
        {!ready ? (
          <p className="hqp-empty">{translate('auto.hqPlus.project.opening', 'Opening…')}</p>
        ) : (
          <RightSidebarPanelContent effectiveTab={view} rightSidebarOpen />
        )}
      </div>
    </div>
  )
}
