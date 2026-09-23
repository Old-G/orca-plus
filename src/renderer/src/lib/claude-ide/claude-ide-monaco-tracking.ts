import type { IDisposable, editor } from 'monaco-editor'
import { monaco } from '@/lib/monaco-setup'
import { translate } from '@/i18n/i18n'
import { mentionEditorSelectionInClaude } from './claude-ide-mention'
import { noteFocusedEditor, selectionOf } from './claude-ide-monaco-state'

// Loaded only once Monaco is: the IDE bridge must not pull the editor bundle
// into app startup.

const SELECTION_DEBOUNCE_MS = 300
const DIAGNOSTICS_DEBOUNCE_MS = 200

function trackSelections(disposables: IDisposable[]): void {
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastSent = ''
  const schedule = (codeEditor: editor.ICodeEditor): void => {
    if (timer) {
      clearTimeout(timer)
    }
    timer = setTimeout(() => {
      timer = null
      const selection = selectionOf(codeEditor)
      const serialized = JSON.stringify(selection)
      if (selection && serialized !== lastSent) {
        lastSent = serialized
        window.api.claudeIde.reportSelection(selection)
      }
    }, SELECTION_DEBOUNCE_MS)
  }
  const track = (codeEditor: editor.ICodeEditor): void => {
    disposables.push(
      codeEditor.onDidChangeCursorSelection(() => schedule(codeEditor)),
      codeEditor.onDidFocusEditorText(() => {
        noteFocusedEditor(codeEditor)
        schedule(codeEditor)
      })
    )
  }
  monaco.editor.getEditors().forEach(track)
  disposables.push(monaco.editor.onDidCreateEditor(track), {
    dispose: () => {
      if (timer) {
        clearTimeout(timer)
      }
    }
  })
}

// Same chord as the VS Code extension: Cmd+Alt+K on macOS, Ctrl+Alt+K elsewhere.
function registerMentionAction(disposables: IDisposable[]): void {
  disposables.push(
    monaco.editor.addEditorAction({
      id: 'orca.claudeIde.mentionSelection',
      label: translate('auto.components.claude.ide.mention.action', 'Mention in Claude Code'),
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyK],
      contextMenuGroupId: '9_claude',
      run: (target) => mentionEditorSelectionInClaude(target)
    })
  )
}

function trackDiagnostics(disposables: IDisposable[]): void {
  const pending = new Set<string>()
  let timer: ReturnType<typeof setTimeout> | null = null
  disposables.push(
    monaco.editor.onDidChangeMarkers((uris) => {
      for (const uri of uris) {
        if (uri.scheme === 'file') {
          pending.add(uri.toString(true))
        }
      }
      if (pending.size === 0 || timer) {
        return
      }
      timer = setTimeout(() => {
        timer = null
        window.api.claudeIde.reportDiagnosticsChanged([...pending])
        pending.clear()
      }, DIAGNOSTICS_DEBOUNCE_MS)
    }),
    {
      dispose: () => {
        if (timer) {
          clearTimeout(timer)
        }
      }
    }
  )
}

export function startClaudeIdeMonacoTracking(): () => void {
  const disposables: IDisposable[] = []
  trackSelections(disposables)
  trackDiagnostics(disposables)
  registerMentionAction(disposables)
  return () => disposables.forEach((disposable) => disposable.dispose())
}
