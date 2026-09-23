import type { editor } from 'monaco-editor'
import { useAppStore } from '@/store'
import { detectLanguage } from '@/lib/language-detect'
import { monaco } from '@/lib/monaco-setup'
import { toEditorModelUri } from '@/components/editor/editor-model-uri'
import { findEditorForPath } from './claude-ide-monaco-state'
import { findOwningLocalWorktree, resolveClaudeIdePath } from './claude-ide-workspace'

const EDITOR_MOUNT_TIMEOUT_MS = 3000

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

// Why: openFile mounts Monaco and loads content asynchronously; selecting before
// the text lands would search an empty model.
async function waitForLoadedEditor(filePath: string): Promise<editor.ICodeEditor | undefined> {
  const deadline = Date.now() + EDITOR_MOUNT_TIMEOUT_MS
  while (Date.now() < deadline) {
    const codeEditor = findEditorForPath(filePath)
    if (codeEditor && (codeEditor.getModel()?.getValueLength() ?? 0) > 0) {
      return codeEditor
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return findEditorForPath(filePath)
}

function selectText(
  codeEditor: editor.ICodeEditor,
  startText: string,
  endText: string | undefined,
  selectToEndOfLine: boolean
): string {
  const model = codeEditor.getModel()
  const text = model?.getValue() ?? ''
  const startOffset = text.indexOf(startText)
  if (!model || startOffset === -1) {
    return `Opened file, but text "${startText}" not found`
  }
  const start = model.getPositionAt(startOffset)
  let end = model.getPositionAt(startOffset + startText.length)
  let message = `Opened file and selected text "${startText}"`
  if (endText) {
    const tail = text.indexOf(endText, startOffset + startText.length)
    if (tail === -1) {
      end = start
      message = `Opened file and positioned at "${startText}" (end text "${endText}" not found)`
    } else {
      end = model.getPositionAt(tail + endText.length)
      if (selectToEndOfLine) {
        end = end.with(undefined, model.getLineMaxColumn(end.lineNumber))
      }
      message = `Opened file and selected text from "${startText}" to "${endText}"`
    }
  }
  const range = monaco.Range.fromPositions(start, end)
  codeEditor.setSelection(range)
  codeEditor.revealRangeInCenter(range)
  return message
}

export function relativeToWorktree(filePath: string, worktreePath: string): string {
  return filePath.slice(worktreePath.replace(/[\\/]+$/, '').length + 1)
}

/** Switches Orca to the worktree's editor the way a click in the sidebar would, around `open`. */
export function openInForegroundWorktree(worktreeId: string, open: () => void): void {
  const store = useAppStore.getState()
  store.setActiveWorktree(worktreeId)
  store.markWorktreeVisited(worktreeId)
  store.setActiveView('terminal')
  open()
  store.setActiveTabType('editor', worktreeId)
  store.revealWorktreeInSidebar(worktreeId)
}

export async function openFileForClaudeIde(params: Record<string, unknown>): Promise<string> {
  const requested = optionalString(params.filePath)
  if (!requested) {
    throw new Error('File path is required')
  }
  const makeFrontmost = params.makeFrontmost !== false
  const filePath = resolveClaudeIdePath(requested)
  const worktree = findOwningLocalWorktree(filePath)
  if (!worktree || !(await window.api.fs.pathExists({ filePath }))) {
    throw new Error(`File not found: ${filePath}`)
  }
  const relativePath = relativeToWorktree(filePath, worktree.path)
  const open = (): void => {
    useAppStore.getState().openFile(
      {
        filePath,
        relativePath,
        worktreeId: worktree.id,
        language: detectLanguage(filePath),
        mode: 'edit'
      },
      { preview: params.preview === true, focusEditor: makeFrontmost }
    )
  }
  if (makeFrontmost) {
    openInForegroundWorktree(worktree.id, open)
  } else {
    open()
  }

  const startText = optionalString(params.startText)
  if (startText) {
    const codeEditor = await waitForLoadedEditor(filePath)
    if (codeEditor) {
      return selectText(
        codeEditor,
        startText,
        optionalString(params.endText),
        params.selectToEndOfLine === true
      )
    }
  }
  const message = `Opened file: ${filePath}`
  if (makeFrontmost) {
    return message
  }
  const fileUrl = toEditorModelUri(filePath)
  const model = monaco.editor.getModel(monaco.Uri.parse(fileUrl))
  const openFile = useAppStore.getState().openFiles.find((file) => file.filePath === filePath)
  return JSON.stringify(
    {
      success: true,
      filePath,
      fileUrl,
      message,
      languageId: detectLanguage(filePath),
      lineCount: model?.getLineCount(),
      isDirty: openFile?.isDirty ?? false,
      isUntitled: false,
      isClosed: false
    },
    null,
    2
  )
}
