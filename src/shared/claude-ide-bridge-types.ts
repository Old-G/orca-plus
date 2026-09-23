// Wire types for Orca acting as a Claude Code IDE: main hosts the MCP server,
// the renderer answers editor-state questions. Payload shapes mirror the VS Code
// extension so the CLI sees the same JSON it gets from VS Code/Cursor.

export type ClaudeIdePosition = { line: number; character: number }

export type ClaudeIdeSelection = {
  text: string
  filePath: string
  fileUrl: string
  selection: { start: ClaudeIdePosition; end: ClaudeIdePosition; isEmpty: boolean }
}

export const CLAUDE_IDE_RENDERER_METHODS = [
  'getDiagnostics',
  'openFile',
  'getOpenEditors',
  'getWorkspaceFolders',
  'getCurrentSelection',
  'checkDocumentDirty',
  'saveDocument',
  'openDiff',
  'closeDiffTab',
  'closeAllDiffTabs'
] as const

export type ClaudeIdeRendererMethod = (typeof CLAUDE_IDE_RENDERER_METHODS)[number]

export type ClaudeIdeRendererRequest = {
  requestId: string
  method: ClaudeIdeRendererMethod
  params: Record<string, unknown>
}

/** `text` is the tool result body, already formatted the way VS Code formats it. */
export type ClaudeIdeRendererResponse =
  | { requestId: string; ok: true; text: string }
  | { requestId: string; ok: false; error: string }

export type ClaudeIdeWorkspaceFolder = { name: string; path: string }

/** Renderer reply to `openDiff`, sent once the user accepts, rejects or closes the diff. */
export type ClaudeIdeDiffOutcome = { accepted: true; contents: string } | { accepted: false }

/** Cmd/Ctrl+Alt+K in an editor: `at_mentioned` for the CLI; lines are 0-based like VS Code's. */
export type ClaudeIdeMentionRequest = {
  filePath: string
  lineStart?: number
  lineEnd?: number
  /** The file's worktree, to pick the CLI running there. */
  worktreeId?: string
}

export type ClaudeIdeMentionResult =
  | { delivered: false }
  | { delivered: true; tabId?: string; worktreeId?: string }
