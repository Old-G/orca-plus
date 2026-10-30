// Custom build (hq-plus-center-browser): Orca's own browser in HQ+'s center column, in place of the feed,
// the way a file from Project opens there — the HQ workspace's browser tab with its signed-in profile,
// address bar and tabs. «⤢» gives it the whole window; «Feed» brings the feed back.
import { useCallback, useEffect } from 'react'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import BrowserPane from '@/components/browser-pane/BrowserPane'
import { registerBrowserOverlaySlotViewport } from '@/components/browser-pane/host-guest/browser-page-viewport'
import { releaseBrowserPageMount } from '@/components/browser-pane/host-guest/browser-page-mount-admission'

const HOST_ATTR = 'data-hqp-browser-host'

/** Code's own slot for the tab, kept while Code is hidden behind HQ. */
function codeSlotRoot(tabId: string): HTMLDivElement | null {
  const slot = document.querySelector(
    `[data-browser-overlay-tab-id="${CSS.escape(tabId)}"]:not([${HOST_ATTR}]) > div`
  )
  return slot instanceof HTMLDivElement ? slot : null
}

/** Opens a page in the HQ workspace's browser: the tab on screen navigates, else a new tab opens. */
export function openHqPlusBrowserPage(worktreeId: string, url: string | null): boolean {
  const state = useAppStore.getState()
  const tabId = state.activeBrowserTabIdByWorktree[worktreeId]
  const tab = state.browserTabsByWorktree[worktreeId]?.find((entry) => entry.id === tabId)
  try {
    if (tab?.activePageId && url) {
      state.setBrowserPageUrl(tab.activePageId, url)
    } else if (!tab) {
      state.createBrowserTab(worktreeId, url ?? 'about:blank', {
        activate: true,
        focusAddressBar: !url
      })
    }
    return true
  } catch (error) {
    // Why: a workspace without managed browsing cannot hold a tab; the link goes to the system browser.
    console.warn('[hq-plus] Orca browser unavailable:', error)
    return false
  }
}

function Host({
  tab
}: {
  tab: NonNullable<ReturnType<typeof useAppStore.getState>['browserTabsByWorktree'][string]>[number]
}): React.JSX.Element {
  // Why: the page lives in one slot per tab; HQ+'s takes it while shown and gives Code's back on leave,
  // in the ref callback — an effect cleanup would run first and be overwritten.
  const slotRef = useCallback(
    (node: HTMLDivElement | null) => {
      registerBrowserOverlaySlotViewport(tab.id, node ?? codeSlotRoot(tab.id))
    },
    [tab.id]
  )
  useEffect(() => {
    // Why: a tab opened just now is admitted to Code's hidden slot too, which would hide HQ+'s copy.
    if (tab.activePageId) {
      releaseBrowserPageMount(tab.activePageId)
    }
  }, [tab.activePageId])
  return (
    <div
      className="hqp-center-browser-host"
      data-browser-overlay-tab-id={tab.id}
      {...{ [HOST_ATTR]: '' }}
    >
      <div className="hqp-center-browser-slot" ref={slotRef} />
      <BrowserPane browserTab={tab} isActive isWorktreeActive chromeShortcutScope="owned-target" />
    </div>
  )
}

export function HqPlusCenterBrowser({
  worktreeId,
  full,
  onFull,
  onClose,
  backLabel = null
}: {
  worktreeId: string
  full: boolean
  onFull: (full: boolean) => void
  onClose: () => void
  /** Custom build (hq-plus-map): where «←» returns to, when not the feed. */
  backLabel?: string | null
}): React.JSX.Element {
  const tab = useAppStore((state) => {
    const id = state.activeBrowserTabIdByWorktree[worktreeId]
    return state.browserTabsByWorktree[worktreeId]?.find((entry) => entry.id === id) ?? null
  })
  return (
    <section
      className="hqp-center-file hqp-center-browser"
      aria-label={translate('auto.hqPlus.centerBrowser', 'Browser')}
    >
      <div className="hqp-fh">
        <button type="button" className="hqp-pill" onClick={onClose}>
          ← {backLabel ?? translate('auto.hqPlus.centerFile.back', 'Feed')}
        </button>
        <span className="hqp-spacer" />
        <button
          type="button"
          className="hqp-pill"
          aria-pressed={full}
          title={
            full
              ? translate('auto.hqPlus.browser.restore', 'Show the side columns')
              : translate('auto.hqPlus.browser.full', 'Whole window')
          }
          onClick={() => onFull(!full)}
        >
          {full ? '⤡' : '⤢'}
        </button>
      </div>
      <div className="hqp-center-file-body">{tab ? <Host key={tab.id} tab={tab} /> : null}</div>
    </section>
  )
}
