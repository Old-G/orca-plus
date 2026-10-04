// Custom build (pwa): Orca+'s web client service worker. It makes the paired web client an
// installable app; it caches nothing, so the page always comes fresh from the paired Mac.
self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

// Custom build (web-push): the Mac sends Declarative Web Push JSON. Safari shows it itself (it hands
// the proposed one to this handler as event.notification); other browsers need it shown here.
self.addEventListener('push', (event) => {
  if (event.notification || !event.data) {
    return
  }
  let message
  try {
    message = event.data.json()
  } catch {
    return
  }
  const notification = message && message.notification
  if (!notification || !notification.title) {
    return
  }
  const badge = Number(notification.app_badge)
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(notification.title, {
        body: notification.body,
        tag: notification.tag,
        data: { navigate: notification.navigate }
      }),
      Number.isFinite(badge) && self.navigator.setAppBadge
        ? self.navigator.setAppBadge(badge).catch(() => {})
        : Promise.resolve()
    ])
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = event.notification.data && event.notification.data.navigate
  if (!target) {
    return
  }
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((client) => 'navigate' in client)
      return open
        ? open.navigate(target).then((client) => client && client.focus())
        : self.clients.openWindow(target)
    })
  )
})
