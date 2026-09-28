// Custom build (hq-group-chat): a group's chat is a folder workspace on HQ's chats/<group>/,
// which HQ's own hq_group_chat.py builds — links to every project of the group and a CLAUDE.md.
import type { FolderWorkspace } from './folder-workspace-types'

export type HqGroupChatResult = { ok: true; path: string } | { ok: false; error: string }

/** The chat folder path from the script's JSON report (its last stdout line). */
export function readHqGroupChatPath(stdout: string): string | null {
  const line = stdout.trim().split('\n').pop()
  if (!line) {
    return null
  }
  try {
    const parsed: unknown = JSON.parse(line)
    const path: unknown = parsed && typeof parsed === 'object' ? Reflect.get(parsed, 'path') : null
    return typeof path === 'string' && path.length > 0 ? path : null
  } catch {
    return null
  }
}

/** The group's live chat workspace, so a second click reopens it instead of adding another. */
export function findHqGroupChatWorkspace(
  workspaces: readonly FolderWorkspace[],
  projectGroupId: string,
  folderPath: string
): FolderWorkspace | null {
  return (
    workspaces.find(
      (workspace) =>
        workspace.projectGroupId === projectGroupId &&
        workspace.folderPath === folderPath &&
        !workspace.isArchived
    ) ?? null
  )
}
