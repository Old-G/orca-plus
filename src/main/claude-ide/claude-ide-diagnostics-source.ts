import { isAbsolute, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { LspSessionManager } from '../lsp/lsp-session-manager'
import { collectLspDiagnosticsForFile } from './claude-ide-lsp-diagnostics'

type RendererEntry = { uri: string; live?: boolean } & Record<string, unknown>

export type ClaudeIdeDiagnosticsSourceDeps = {
  /** Renderer markers; with a uri, each entry says whether a mounted editor backs it. */
  askRenderer: (params: Record<string, unknown>) => Promise<string>
  workspaceFolders: () => string[]
  getLspManager: () => LspSessionManager | null
}

function parseEntries(text: string | null): RendererEntry[] {
  if (!text) {
    return []
  }
  const parsed: unknown = JSON.parse(text)
  return Array.isArray(parsed) ? parsed : []
}

function withoutLiveFlag(entries: RendererEntry[]): string {
  return JSON.stringify(
    entries.map(({ live: _live, ...entry }) => entry),
    null,
    2
  )
}

/** Innermost folder containing the file; LSP servers only start inside known workspaces. */
function owningFolder(filePath: string, folders: string[]): string | undefined {
  return folders
    .filter(
      (folder) =>
        filePath === folder || filePath.startsWith(folder.endsWith(sep) ? folder : folder + sep)
    )
    .sort((a, b) => b.length - a.length)[0]
}

/**
 * VS Code answers from diagnostics it keeps for every open document. Orca only
 * keeps markers for editors on screen, so a file nobody is looking at is asked
 * of the LSP server directly, from its text on disk.
 */
export function createClaudeIdeDiagnosticsSource(deps: ClaudeIdeDiagnosticsSourceDeps) {
  return async function getDiagnostics(params: Record<string, unknown>): Promise<string> {
    const uri = typeof params.uri === 'string' && params.uri.length > 0 ? params.uri : undefined
    const rendererEntries = parseEntries(await deps.askRenderer(params).catch(() => null))
    if (!uri || rendererEntries.some((entry) => entry.live)) {
      return withoutLiveFlag(rendererEntries)
    }
    const folders = deps.workspaceFolders()
    const requested = uri.startsWith('file:') ? fileURLToPath(uri) : uri
    const filePath = isAbsolute(requested) || !folders[0] ? requested : join(folders[0], requested)
    const rootPath = owningFolder(filePath, folders)
    const manager = deps.getLspManager()
    if (!rootPath || !manager) {
      return withoutLiveFlag(rendererEntries)
    }
    const fromLsp = await collectLspDiagnosticsForFile(manager, { filePath, rootPath }).catch(
      () => null
    )
    return fromLsp ? JSON.stringify([fromLsp], null, 2) : withoutLiveFlag(rendererEntries)
  }
}
