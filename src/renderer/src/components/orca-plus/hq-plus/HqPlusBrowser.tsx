// Custom build (hq-plus-round6): HQ+'s Browser tab — one page in the right panel on the browser's own
// session, so Slack, ClickUp and reports open signed in. Links from HQ+ land here; ↗ hands the page to
// the system browser. The page stays mounted while other tabs show: moving a webview reloads it.
import { useEffect, useRef, useState } from 'react'
import { ORCA_BROWSER_GUEST_WEB_PREFERENCES_ATTRIBUTE } from '../../../../../shared/browser-guest-web-preferences'
import { moveFocusToRendererBeforeWebviewDetach } from '@/components/browser-pane/host-guest/webview-registry'
import { useDocPreviewWebviewHistory } from '@/components/browser-pane/workspace-doc/doc-preview-webview-history'
import { translate } from '@/i18n/i18n'

/** What the owner typed, as a page to open: a bare host gets https; anything else is refused. */
export function hqPlusBrowserUrl(input: string): string | null {
  const value = input.trim()
  if (!value || /\s/.test(value)) {
    return null
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`
  try {
    const url = new URL(withScheme)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch {
    return null
  }
}

/** A page HQ+ asks for; `n` grows with every ask, so asking for the same page again navigates too. */
export type HqPlusBrowserAsk = { url: string; n: number }

export function HqPlusBrowser({
  ask,
  onUrl,
  onOpen
}: {
  ask: HqPlusBrowserAsk | null
  /** The page the owner is on now, to come back to it. */
  onUrl: (url: string) => void
  /** An address typed before any page was open. */
  onOpen: (url: string) => void
}): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const webviewRef = useRef<Electron.WebviewTag | null>(null)
  const history = useDocPreviewWebviewHistory(webviewRef)
  const url = ask?.url ?? null
  const [address, setAddress] = useState(url ?? '')
  const [current, setCurrent] = useState(url)
  const [outside, setOutside] = useState(false)
  const [failed, setFailed] = useState(false)
  const onUrlRef = useRef(onUrl)
  onUrlRef.current = onUrl
  const { sync } = history

  const wantedRef = useRef(url)
  wantedRef.current = url
  const creatingRef = useRef(false)
  useEffect(() => {
    if (!url) {
      return
    }
    setAddress(url)
    const webview = webviewRef.current
    if (webview) {
      void webview.loadURL(url).catch(() => setFailed(true))
      return
    }
    if (creatingRef.current) {
      return
    }
    creatingRef.current = true
    void window.api.browser.sessionResolvePartition({ profileId: null }).then((partition) => {
      creatingRef.current = false
      const host = hostRef.current
      const wanted = wantedRef.current
      if (!partition && wanted) {
        // Why: no browser session here (a web client); the page opens outside rather than nowhere.
        setOutside(true)
        void window.api.shell.openUrl(wanted)
        return
      }
      if (!partition || !host?.isConnected || !wanted || webviewRef.current) {
        return
      }
      // SAFETY: createElement('webview') makes Electron's webview tag; DOM typings only know HTMLElement.
      const created = document.createElement('webview') as Electron.WebviewTag
      created.setAttribute('partition', partition)
      created.setAttribute('webpreferences', ORCA_BROWSER_GUEST_WEB_PREFERENCES_ATTRIBUTE)
      created.setAttribute('aria-label', translate('auto.hqPlus.browser.page', 'Browser page'))
      created.className = 'hqp-browser-page'
      const moved = (event: Electron.DidNavigateEvent | Electron.DidNavigateInPageEvent): void => {
        if ('isMainFrame' in event && !event.isMainFrame) {
          return
        }
        setFailed(false)
        setAddress(event.url)
        setCurrent(event.url)
        onUrlRef.current(event.url)
        sync()
      }
      created.addEventListener('did-navigate', moved)
      created.addEventListener('did-navigate-in-page', moved)
      created.addEventListener('did-fail-load', (event) => {
        if (event.isMainFrame && event.errorCode !== -3) {
          setFailed(true)
        }
      })
      host.appendChild(created)
      created.setAttribute('src', wanted)
      webviewRef.current = created
    })
  }, [ask, url, sync])

  // Why: the page lives as long as HQ+ does; leaving HQ+ drops it with focus moved off it first.
  useEffect(
    () => () => {
      const webview = webviewRef.current
      if (webview) {
        moveFocusToRendererBeforeWebviewDetach(webview)
        webview.remove()
        webviewRef.current = null
      }
    },
    []
  )

  const go = (): void => {
    const next = hqPlusBrowserUrl(address)
    const webview = webviewRef.current
    if (!next) {
      return
    }
    if (webview) {
      void webview.loadURL(next).catch(() => setFailed(true))
    } else {
      onOpen(next)
    }
  }

  return (
    <div className="hqp-browser">
      <form
        className="hqp-browser-bar"
        onSubmit={(event) => {
          event.preventDefault()
          go()
        }}
      >
        <button
          type="button"
          className="hqp-link"
          disabled={!history.canGoBack}
          title={translate('auto.hqPlus.browser.back', 'Back')}
          aria-label={translate('auto.hqPlus.browser.back', 'Back')}
          onClick={history.goBack}
        >
          ‹
        </button>
        <button
          type="button"
          className="hqp-link"
          disabled={!history.canGoForward}
          title={translate('auto.hqPlus.browser.forward', 'Forward')}
          aria-label={translate('auto.hqPlus.browser.forward', 'Forward')}
          onClick={history.goForward}
        >
          ›
        </button>
        <input
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          placeholder={translate('auto.hqPlus.browser.address', 'Address')}
          aria-label={translate('auto.hqPlus.browser.address', 'Address')}
          spellCheck={false}
        />
        <button
          type="button"
          className="hqp-link"
          disabled={!current}
          title={translate('auto.hqPlus.browser.outside', 'Open in the system browser')}
          aria-label={translate('auto.hqPlus.browser.outside', 'Open in the system browser')}
          onClick={() => current && void window.api.shell.openUrl(current)}
        >
          ↗
        </button>
      </form>
      {outside ? (
        <p className="hqp-empty">
          {translate('auto.hqPlus.browser.openedOutside', 'Opened in the system browser.')}
        </p>
      ) : null}
      {failed ? (
        <p className="hqp-empty">
          {translate('auto.hqPlus.browser.failed', 'The page did not load.')}
        </p>
      ) : null}
      {url ? null : (
        <p className="hqp-empty">
          {translate(
            'auto.hqPlus.browser.empty',
            'Links from HQ+ open here — Slack, ClickUp, reports. Or type an address.'
          )}
        </p>
      )}
      <div ref={hostRef} className="hqp-browser-host" />
    </div>
  )
}
