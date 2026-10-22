// Custom build (hq-clickup-requests): which HQ project a ClickUp list belongs to, by HQ's list bindings.
import { listHqProjectPages } from '../hq-project-pages/hq-project-pages'

export async function hqClickUpListProjects(
  hq: string,
  bindings: Record<string, { listId: string }>
): Promise<(listId: string | null) => string | null> {
  const pages = await listHqProjectPages(hq).catch(() => [])
  return (listId) => {
    const repoId = Object.entries(bindings).find(
      ([, binding]) => listId && binding.listId === listId
    )?.[0]
    return pages.find((page) => page.repoId === repoId)?.slug ?? null
  }
}
