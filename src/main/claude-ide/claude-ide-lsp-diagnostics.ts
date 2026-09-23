import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { LspSessionManager } from '../lsp/lsp-session-manager'

// Diagnostics for a file no visible editor holds. Orca detaches LSP when an
// editor tab is hidden (terminal and editor share a tab group), so the CLI's
// "did my edit break anything" check would otherwise always see nothing.

const PUSH_DIAGNOSTICS_TIMEOUT_MS = 5000

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust'
}

const SEVERITY_NAMES = ['Error', 'Warning', 'Information', 'Hint']

type LspPosition = { line: number; character: number }
type LspDiagnostic = {
  message: string
  severity?: number
  range: { start: LspPosition; end: LspPosition }
  source?: string
  code?: string | number | { value: string | number }
}

/** VS Code's `languages.getDiagnostics` entry, as the extension serializes it. */
export type ClaudeIdeFileDiagnostics = {
  uri: string
  linesInFile: number
  diagnostics: {
    message: string
    severity: string
    range: { start: LspPosition; end: LspPosition }
    source?: string
    code?: string
  }[]
}

function toVsCodeDiagnostic(
  diagnostic: LspDiagnostic
): ClaudeIdeFileDiagnostics['diagnostics'][number] {
  const code = typeof diagnostic.code === 'object' ? diagnostic.code.value : diagnostic.code
  return {
    message: diagnostic.message,
    severity: SEVERITY_NAMES[(diagnostic.severity ?? 1) - 1] ?? 'Error',
    range: {
      start: { line: diagnostic.range.start.line, character: diagnostic.range.start.character },
      end: { line: diagnostic.range.end.line, character: diagnostic.range.end.character }
    },
    ...(diagnostic.source ? { source: diagnostic.source } : {}),
    ...(code === undefined ? {} : { code: String(code) })
  }
}

function isLspDiagnostic(value: unknown): value is LspDiagnostic {
  return (
    typeof value === 'object' &&
    value !== null &&
    'message' in value &&
    typeof value.message === 'string' &&
    'range' in value
  )
}

function pullItems(result: unknown): unknown[] {
  if (
    typeof result === 'object' &&
    result !== null &&
    'items' in result &&
    Array.isArray(result.items)
  ) {
    return result.items
  }
  return []
}

/** Null when no LSP server covers the file's language. */
export async function collectLspDiagnosticsForFile(
  manager: LspSessionManager,
  args: { filePath: string; rootPath: string }
): Promise<ClaudeIdeFileDiagnostics | null> {
  const languageId = LANGUAGE_BY_EXTENSION[extname(args.filePath).toLowerCase()]
  if (!languageId) {
    return null
  }
  const text = await readFile(args.filePath, 'utf8')
  const fileUri = pathToFileURL(args.filePath).toString()
  let pushed: unknown[] | null = null
  let wake: (() => void) | null = null
  // Why: subscribe before didOpen — a push server can publish while openDocument resolves.
  const unsubscribe = manager.onDiagnostics((payload) => {
    if (payload.fileUri === fileUri) {
      pushed = payload.diagnostics
      wake?.()
    }
  })
  try {
    const opened = await manager.openDocument({ ...args, languageId, text })
    if (!opened.sessionId || !opened.fileUri) {
      return null
    }
    try {
      let raw: unknown[]
      if (opened.pullDiagnostics) {
        raw = pullItems(
          await manager.request(opened.sessionId, 'textDocument/diagnostic', {
            textDocument: { uri: opened.fileUri }
          })
        )
      } else {
        if (pushed === null) {
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, PUSH_DIAGNOSTICS_TIMEOUT_MS)
            wake = () => {
              clearTimeout(timer)
              resolve()
            }
          })
        }
        raw = pushed ?? []
      }
      return {
        uri: fileUri,
        linesInFile: text.split('\n').length,
        diagnostics: raw.filter(isLspDiagnostic).map(toVsCodeDiagnostic)
      }
    } finally {
      manager.closeDocument(opened.sessionId, opened.fileUri)
    }
  } finally {
    unsubscribe()
  }
}
