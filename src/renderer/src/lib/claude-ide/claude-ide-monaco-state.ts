import type { editor } from 'monaco-editor'
import { monaco } from '@/lib/monaco-setup'
import { useAppStore } from '@/store'
import { toEditorModelUri } from '@/components/editor/editor-model-uri'
import type { ClaudeIdeSelection } from '../../../../shared/claude-ide-bridge-types'

// Monaco is 1-based; the payloads mirror VS Code's 0-based positions.

let lastFocusedEditor: editor.ICodeEditor | null = null

export function noteFocusedEditor(codeEditor: editor.ICodeEditor): void {
  lastFocusedEditor = codeEditor
}

function isFileEditor(codeEditor: editor.ICodeEditor): boolean {
  return codeEditor.getModel()?.uri.scheme === 'file'
}

export function findEditorForPath(filePath: string): editor.ICodeEditor | undefined {
  const modelUri = toEditorModelUri(filePath)
  const matches = monaco.editor
    .getEditors()
    .filter((codeEditor) => codeEditor.getModel()?.uri.toString() === modelUri)
  return matches.find((codeEditor) => codeEditor.hasTextFocus()) ?? matches[0]
}

/** VS Code's `activeTextEditor`: the active editor tab, else the last focused file editor. */
export function activeCodeEditor(): editor.ICodeEditor | undefined {
  const state = useAppStore.getState()
  const activeFile = state.openFiles.find((file) => file.id === state.activeFileId)
  if (state.activeTabType === 'editor' && activeFile?.mode === 'edit') {
    const found = findEditorForPath(activeFile.filePath)
    if (found) {
      return found
    }
  }
  const alive = lastFocusedEditor && monaco.editor.getEditors().includes(lastFocusedEditor)
  return alive && lastFocusedEditor && isFileEditor(lastFocusedEditor)
    ? lastFocusedEditor
    : undefined
}

export function selectionOf(codeEditor: editor.ICodeEditor): ClaudeIdeSelection | null {
  const model = codeEditor.getModel()
  const selection = codeEditor.getSelection()
  if (!model || !selection || model.uri.scheme !== 'file') {
    return null
  }
  return {
    text: model.getValueInRange(selection),
    filePath: model.uri.fsPath,
    fileUrl: model.uri.toString(),
    selection: {
      start: { line: selection.startLineNumber - 1, character: selection.startColumn - 1 },
      end: { line: selection.endLineNumber - 1, character: selection.endColumn - 1 },
      isEmpty: selection.isEmpty()
    }
  }
}

const SEVERITY_NAMES: Record<number, string> = {
  1: 'Hint',
  2: 'Information',
  4: 'Warning',
  8: 'Error'
}

function markerCode(code: editor.IMarker['code']): string | undefined {
  if (code === undefined) {
    return undefined
  }
  return typeof code === 'string' ? code : String(code.value)
}

function toMonacoUri(uri: string) {
  return uri.startsWith('file:') ? monaco.Uri.parse(uri) : monaco.Uri.file(uri)
}

/** Same shape as the extension's getDiagnostics: one entry per file. */
export function collectDiagnostics(uri?: string): unknown[] {
  const resource = uri ? toMonacoUri(uri) : undefined
  const markers = monaco.editor
    .getModelMarkers(resource ? { resource } : {})
    .filter((marker) => marker.resource.scheme === 'file')
  const byUri = new Map<string, editor.IMarker[]>()
  if (resource) {
    byUri.set(resource.toString(), [])
  }
  for (const marker of markers) {
    const key = marker.resource.toString()
    byUri.set(key, [...(byUri.get(key) ?? []), marker])
  }
  return [...byUri].map(([key, fileMarkers]) => {
    const fileUri = monaco.Uri.parse(key)
    return {
      uri: fileUri.toString(true),
      linesInFile: monaco.editor.getModel(fileUri)?.getLineCount(),
      // Why: main falls back to the LSP server when no mounted editor keeps these current.
      ...(resource ? { live: findEditorForPath(fileUri.fsPath) !== undefined } : {}),
      diagnostics: fileMarkers.map((marker) => ({
        message: marker.message,
        severity: SEVERITY_NAMES[marker.severity] ?? 'Error',
        range: {
          start: { line: marker.startLineNumber - 1, character: marker.startColumn - 1 },
          end: { line: marker.endLineNumber - 1, character: marker.endColumn - 1 }
        },
        source: marker.source,
        code: markerCode(marker.code)
      }))
    }
  })
}
