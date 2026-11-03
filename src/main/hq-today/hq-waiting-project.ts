// Custom build (hq-waiting-project, owner 03.11, plan stage 20.6): a note's project is one of HQ's. A
// chat that writes «lh-mcp-server-gitlab» for the page `mcp-server-gitlab`, or no project at all,
// files the note where no project view finds it. The given name counts when it matches a slug
// (case, `_` and `-` aside); else the project of the chat that wrote the note (С10); else none.

const norm = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-')

export function hqWaitingProject(
  given: string | null | undefined,
  chatProject: string | null | undefined,
  slugs: readonly string[]
): string | null {
  // Why: with no HQ list to check against, the chat's word is all there is.
  if (slugs.length === 0) {
    return given?.trim() || chatProject?.trim() || null
  }
  const find = (name: string | null | undefined): string | null =>
    name ? (slugs.find((slug) => norm(slug) === norm(name)) ?? null) : null
  return find(given) ?? find(chatProject)
}
