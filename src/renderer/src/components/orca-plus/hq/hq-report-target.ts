// Custom build (hq-reports): which report HQ's Reports page should show, asked by the bell or a push.
type Listener = (path: string) => void

let requested: string | null = null
const listeners = new Set<Listener>()

export function requestHqReport(path: string): void {
  requested = path
  for (const listener of listeners) {
    listener(path)
  }
}

/** The report someone asked for, once; null when nobody asked. */
export function takeRequestedHqReport(): string | null {
  const path = requested
  requested = null
  return path
}

export function onHqReportRequested(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
