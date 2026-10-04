// Custom build (pwa): registers the web client's service worker, which is what lets a phone install
// the paired web client as an app. Browsers allow it only in a secure context (HTTPS or localhost).
type ServiceWorkerHost = { serviceWorker?: Pick<ServiceWorkerContainer, 'register'> }

export function registerWebServiceWorker(
  host: ServiceWorkerHost = navigator,
  secureContext: boolean = window.isSecureContext
): void {
  if (!secureContext || !host.serviceWorker) {
    return
  }
  // Why relative: the page may sit under a reverse-proxy prefix, and the worker's scope is its folder.
  void host.serviceWorker.register('./sw.js').catch((error: unknown) => {
    console.warn('[pwa] service worker registration failed', error)
  })
}
