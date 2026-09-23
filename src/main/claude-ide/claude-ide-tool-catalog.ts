import { z } from 'zod'
import type { ClaudeIdeRendererMethod } from '../../shared/claude-ide-bridge-types'
import {
  formatCloseAllDiffTabsResult,
  formatCloseTabResult,
  formatOpenDiffResult
} from './claude-ide-diff-results'

// Names, descriptions and argument schemas copied from the Claude Code VS Code
// extension (2.1.280) so the CLI treats Orca exactly like VS Code/Cursor.
// executeCode is left out: it is Jupyter-only.

export type ClaudeIdeToolContent = { type: 'text'; text: string }

export type ClaudeIdeToolDefinition = {
  name: string
  /** Absent where the extension registers the tool without one (close_tab). */
  description?: string
  argumentSchema: Record<string, z.ZodType>
  readOnly?: boolean
  /** Answered by the renderer; absent means main answers from its own state. */
  rendererMethod?: ClaudeIdeRendererMethod
  /** Blocks until the user decides in the editor, so no renderer timeout. */
  waitsForUser?: boolean
  /** Only the interactive CLI calls it (its permission prompt); kept off the SDK server. */
  terminalOnly?: boolean
  /** Turns the renderer reply into the extension's result; default is one text block. */
  formatResult?: (reply: string, args: Record<string, unknown>) => ClaudeIdeToolContent[]
}

const DIFF_PATH_DESCRIPTION =
  'Path to the file to show diff for. If not provided, uses active editor.'

export const CLAUDE_IDE_TOOLS: readonly ClaudeIdeToolDefinition[] = [
  {
    name: 'openDiff',
    description: 'Open a git diff for the file',
    argumentSchema: {
      old_file_path: z.string().describe(DIFF_PATH_DESCRIPTION),
      new_file_path: z.string().describe(DIFF_PATH_DESCRIPTION),
      new_file_contents: z
        .string()
        .describe(
          'Contents of the new file. If not provided then the current file contents of new_file_path will be used.'
        ),
      tab_name: z.string().describe(DIFF_PATH_DESCRIPTION)
    },
    rendererMethod: 'openDiff',
    waitsForUser: true,
    terminalOnly: true,
    formatResult: formatOpenDiffResult
  },
  {
    name: 'getDiagnostics',
    description: 'Get language diagnostics from VS Code',
    argumentSchema: {
      uri: z
        .string()
        .optional()
        .describe(
          'Optional file URI to get diagnostics for. If not provided, gets diagnostics for all files.'
        )
    },
    rendererMethod: 'getDiagnostics'
  },
  {
    name: 'close_tab',
    argumentSchema: { tab_name: z.string() },
    rendererMethod: 'closeDiffTab',
    terminalOnly: true,
    formatResult: formatCloseTabResult
  },
  {
    name: 'closeAllDiffTabs',
    description: 'Close all diff tabs in the editor',
    argumentSchema: {},
    rendererMethod: 'closeAllDiffTabs',
    terminalOnly: true,
    formatResult: formatCloseAllDiffTabsResult
  },
  {
    name: 'openFile',
    description: 'Open a file in the editor and optionally select a range of text',
    argumentSchema: {
      filePath: z.string().describe('Path to the file to open'),
      preview: z.boolean().describe('Whether to open the file in preview mode').default(false),
      startText: z
        .string()
        .optional()
        .describe(
          'Text pattern to find the start of the selection range. Selects from the beginning of this match.'
        ),
      endText: z
        .string()
        .optional()
        .describe(
          'Text pattern to find the end of the selection range. Selects up to the end of this match. If not provided, only the startText match will be selected.'
        ),
      selectToEndOfLine: z
        .boolean()
        .describe(
          'If true, selection will extend to the end of the line containing the endText match.'
        )
        .default(false),
      makeFrontmost: z
        .boolean()
        .describe(
          'Whether to make the file the active editor tab. If false, the file will be opened in the background without changing focus.'
        )
        .default(true)
    },
    readOnly: true,
    rendererMethod: 'openFile'
  },
  {
    name: 'getOpenEditors',
    description: 'Get information about currently open editors',
    argumentSchema: {},
    rendererMethod: 'getOpenEditors'
  },
  {
    name: 'getWorkspaceFolders',
    description: 'Get all workspace folders currently open in the IDE',
    argumentSchema: {},
    rendererMethod: 'getWorkspaceFolders'
  },
  {
    name: 'getCurrentSelection',
    description: 'Get the current text selection in the active editor',
    argumentSchema: {},
    rendererMethod: 'getCurrentSelection'
  },
  {
    name: 'checkDocumentDirty',
    description: 'Check if a document has unsaved changes (is dirty)',
    argumentSchema: { filePath: z.string().describe('Path to the file to check') },
    rendererMethod: 'checkDocumentDirty'
  },
  {
    name: 'saveDocument',
    description: 'Save a document with unsaved changes',
    argumentSchema: { filePath: z.string().describe('Path to the file to save') },
    rendererMethod: 'saveDocument'
  },
  {
    name: 'getLatestSelection',
    description: 'Get the most recent text selection (even if not in the active editor)',
    argumentSchema: {}
  }
]

export function findClaudeIdeTool(name: string): ClaudeIdeToolDefinition | undefined {
  return CLAUDE_IDE_TOOLS.find((tool) => tool.name === name)
}

export function claudeIdeToolInputJsonSchema(tool: ClaudeIdeToolDefinition): unknown {
  return z.toJSONSchema(z.object(tool.argumentSchema), { io: 'input' })
}
