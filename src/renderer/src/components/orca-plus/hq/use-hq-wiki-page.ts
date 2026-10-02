// Custom build (hq): one HQ markdown page, read again whenever the asked path changes.
import { useEffect, useState } from 'react'

export type HqWikiPageState =
  | { status: 'loading'; path: string }
  | { status: 'ready'; path: string; markdown: string }
  | { status: 'error'; path: string; message: string }

export function useHqWikiPage(path: string | null): HqWikiPageState | null {
  const [page, setPage] = useState<HqWikiPageState | null>(null)
  useEffect(() => {
    if (!path) {
      return
    }
    let alive = true
    window.api.hqProjects
      .wikiPage(path)
      .then((result) => {
        if (alive) {
          setPage(
            result.ok
              ? { status: 'ready', path, markdown: result.markdown }
              : { status: 'error', path, message: result.error }
          )
        }
      })
      .catch((error: unknown) => {
        if (alive) {
          setPage({ status: 'error', path, message: String(error) })
        }
      })
    return () => {
      alive = false
    }
  }, [path])
  if (!path) {
    return null
  }
  return page?.path === path ? page : { status: 'loading', path }
}
