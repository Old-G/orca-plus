import { useAppStore } from '@/store'
import { requestEditorFileSave } from '@/components/editor/editor-autosave'
import { toEditorModelUri } from '@/components/editor/editor-model-uri'
import { monaco } from '@/lib/monaco-setup'
import type { ClaudeIdeRendererMethod } from '../../../../shared/claude-ide-bridge-types'
import { activeCodeEditor, collectDiagnostics, selectionOf } from './claude-ide-monaco-state'
import { closeAllClaudeDiffTabs, closeClaudeDiffTab } from './claude-ide-diff-proposal-state'
import { openClaudeIdeDiff } from './claude-ide-diff-proposals'
import { openFileForClaudeIde } from './claude-ide-open-file'
import { claudeIdeWorkspaceFolders, resolveClaudeIdePath } from './claude-ide-workspace'

// Result texts copy the Claude Code VS Code extension word for word; the CLI and
// the model were tuned against them.

const json = (value: unknown): string => JSON.stringify(value, null, 2)
// Why: protocol text read by the Claude CLI (English, like the VS Code extension), not UI copy.
const failure = (message: string): string => json({ success: false, message })

function stringParam(params: Record<string, unknown>, key: string): string {
  const value = params[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('File path is required')
  }
  return value
}

function openEditFile(filePath: string) {
  return useAppStore
    .getState()
    .openFiles.find((file) => file.mode === 'edit' && file.filePath === filePath)
}

function getOpenEditors(): string {
  const state = useAppStore.getState()
  const active = activeCodeEditor()
  const tabs = state.openFiles
    .filter((file) => file.mode === 'edit')
    .map((file) => {
      const model = monaco.editor.getModel(monaco.Uri.parse(toEditorModelUri(file.filePath)))
      const isActive = file.id === state.activeFileId
      const selection = active && active.getModel() === model ? active.getSelection() : null
      return {
        uri: toEditorModelUri(file.filePath),
        isActive,
        isPinned: false,
        isPreview: file.isPreview === true,
        isDirty: file.isDirty,
        label: file.relativePath.split(/[\\/]/).pop() ?? file.relativePath,
        groupIndex: 0,
        viewColumn: 1,
        isGroupActive: true,
        fileName: file.filePath,
        languageId: file.language,
        ...(model ? { lineCount: model.getLineCount() } : {}),
        isUntitled: file.isUntitled === true,
        ...(selection
          ? {
              selection: {
                start: {
                  line: selection.startLineNumber - 1,
                  character: selection.startColumn - 1
                },
                end: { line: selection.endLineNumber - 1, character: selection.endColumn - 1 },
                isReversed: selection.getDirection() === monaco.SelectionDirection.RTL
              }
            }
          : {})
      }
    })
  return json({ tabs })
}

function getWorkspaceFolders(): string {
  const folders = claudeIdeWorkspaceFolders().map((folder, index) => ({
    name: folder.name,
    uri: toEditorModelUri(folder.path),
    path: folder.path,
    index
  }))
  return json({
    success: true,
    folders,
    rootPath: folders[0]?.path ?? null,
    workspaceFile: null
  })
}

function getCurrentSelection(): string {
  const codeEditor = activeCodeEditor()
  const selection = codeEditor ? selectionOf(codeEditor) : null
  if (!selection) {
    return failure('No active editor found')
  }
  return json({ success: true, ...selection })
}

function checkDocumentDirty(params: Record<string, unknown>): string {
  const filePath = resolveClaudeIdePath(stringParam(params, 'filePath'))
  const file = openEditFile(filePath)
  if (!file) {
    return failure(`Document not open: ${filePath}`)
  }
  return json({
    success: true,
    filePath,
    isDirty: file.isDirty,
    isUntitled: file.isUntitled === true
  })
}

async function saveDocument(params: Record<string, unknown>): Promise<string> {
  const filePath = resolveClaudeIdePath(stringParam(params, 'filePath'))
  const file = openEditFile(filePath)
  if (!file) {
    return failure(`Document not open: ${filePath}`)
  }
  let saved = false
  if (file.isDirty && file.isUntitled !== true) {
    await requestEditorFileSave({ fileId: file.id })
    saved = openEditFile(filePath)?.isDirty === false
  }
  return json({
    success: true,
    filePath,
    saved,
    message: saved ? 'Document saved successfully' : 'Document was not dirty or save failed'
  })
}

export async function handleClaudeIdeRequest(
  method: ClaudeIdeRendererMethod,
  params: Record<string, unknown>
): Promise<string> {
  switch (method) {
    case 'getDiagnostics':
      return json(collectDiagnostics(typeof params.uri === 'string' ? params.uri : undefined))
    case 'openFile':
      return openFileForClaudeIde(params)
    case 'getOpenEditors':
      return getOpenEditors()
    case 'getWorkspaceFolders':
      return getWorkspaceFolders()
    case 'getCurrentSelection':
      return getCurrentSelection()
    case 'checkDocumentDirty':
      return checkDocumentDirty(params)
    case 'saveDocument':
      return saveDocument(params)
    case 'openDiff':
      return openClaudeIdeDiff(params)
    case 'closeDiffTab':
      return closeClaudeDiffTab(params)
    case 'closeAllDiffTabs':
      return closeAllClaudeDiffTabs()
  }
}
