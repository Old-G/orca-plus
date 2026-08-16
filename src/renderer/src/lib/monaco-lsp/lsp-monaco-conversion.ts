/** Pure LSP↔Monaco shape converters. LSP is 0-based, Monaco 1-based; both use
 *  UTF-16 columns, so only the off-by-one shift is needed. Monaco enum objects
 *  are passed in by the caller so this module stays import-free and node-testable. */

import type { IRange } from 'monaco-editor'
import {
  asLspRecord,
  readLspArray,
  readLspNumber,
  readLspRange,
  readLspString,
  type LspPosition,
  type LspRange
} from '../../../../shared/lsp-protocol-narrowing'

export const LSP_MARKER_OWNER = 'orca-lsp'

export type { LspPosition, LspRange } from '../../../../shared/lsp-protocol-narrowing'

export function toLspPosition(position: { lineNumber: number; column: number }): LspPosition {
  return { line: position.lineNumber - 1, character: position.column - 1 }
}

export function lspRangeToMonaco(range: LspRange): IRange {
  return {
    startLineNumber: range.start.line + 1,
    startColumn: range.start.character + 1,
    endLineNumber: range.end.line + 1,
    endColumn: range.end.character + 1
  }
}

/** MarkedString | MarkupContent → Markdown; null when the value is neither. */
function markedStringToMarkdown(content: unknown): string | null {
  if (typeof content === 'string') {
    return content
  }
  const record = asLspRecord(content)
  const value = readLspString(record?.value)
  if (value === undefined) {
    return null
  }
  const language = readLspString(record?.language)
  return language ? `\`\`\`${language}\n${value}\n\`\`\`` : value
}

export function lspHoverToMonaco(
  result: unknown
): { contents: { value: string }[]; range?: IRange } | null {
  const hover = asLspRecord(result)
  if (!hover || hover.contents === undefined || hover.contents === null) {
    return null
  }
  const parts = readLspArray(hover.contents) ?? [hover.contents]
  const contents = parts
    .map(markedStringToMarkdown)
    .filter((value): value is string => value !== null && value.trim().length > 0)
    .map((value) => ({ value }))
  if (contents.length === 0) {
    return null
  }
  const range = readLspRange(hover.range)
  return range ? { contents, range: lspRangeToMonaco(range) } : { contents }
}

export function lspDefinitionToLocations(result: unknown): { uri: string; range: IRange }[] {
  if (!result) {
    return []
  }
  const items = readLspArray(result) ?? [result]
  return items.flatMap((item) => {
    const link = asLspRecord(item)
    const targetUri = readLspString(link?.targetUri)
    const targetRange = readLspRange(link?.targetRange)
    if (targetUri && targetRange) {
      const range = readLspRange(link?.targetSelectionRange) ?? targetRange
      return [{ uri: targetUri, range: lspRangeToMonaco(range) }]
    }
    const uri = readLspString(link?.uri)
    const range = readLspRange(link?.range)
    return uri && range ? [{ uri, range: lspRangeToMonaco(range) }] : []
  })
}

// LSP CompletionItemKind codes (1-based) by Monaco kind name.
const LSP_COMPLETION_KIND_NAMES: readonly string[] = [
  'Text',
  'Method',
  'Function',
  'Constructor',
  'Field',
  'Variable',
  'Class',
  'Interface',
  'Module',
  'Property',
  'Unit',
  'Value',
  'Enum',
  'Keyword',
  'Snippet',
  'Color',
  'File',
  'Reference',
  'Folder',
  'EnumMember',
  'Constant',
  'Struct',
  'Event',
  'Operator',
  'TypeParameter'
]

export type LspCompletionSuggestion = {
  label: string
  kind: number
  detail?: string
  documentation?: { value: string }
  sortText?: string
  filterText?: string
  insertText: string
  insertTextRules?: number
  range: IRange
}

function lspCompletionItemToSuggestion(
  raw: unknown,
  defaultRange: IRange,
  enums: { kinds: Record<string, number>; snippetRule: number }
): LspCompletionSuggestion | null {
  const item = asLspRecord(raw)
  const label = readLspString(item?.label)
  if (!item || label === undefined) {
    return null
  }
  const textEdit = asLspRecord(item.textEdit)
  const editRange = readLspRange(textEdit?.range) ?? readLspRange(textEdit?.insert)
  const kindName = LSP_COMPLETION_KIND_NAMES[(readLspNumber(item.kind) ?? 1) - 1] ?? 'Text'
  const suggestion: LspCompletionSuggestion = {
    label,
    kind: enums.kinds[kindName] ?? enums.kinds.Text,
    insertText: readLspString(textEdit?.newText) ?? readLspString(item.insertText) ?? label,
    range: editRange ? lspRangeToMonaco(editRange) : defaultRange
  }
  const detail = readLspString(item.detail)
  if (detail) {
    suggestion.detail = detail
  }
  const documentation = item.documentation ? markedStringToMarkdown(item.documentation) : null
  if (documentation) {
    suggestion.documentation = { value: documentation }
  }
  const sortText = readLspString(item.sortText)
  if (sortText) {
    suggestion.sortText = sortText
  }
  const filterText = readLspString(item.filterText)
  if (filterText) {
    suggestion.filterText = filterText
  }
  if (item.insertTextFormat === 2) {
    suggestion.insertTextRules = enums.snippetRule
  }
  return suggestion
}

export function lspCompletionToMonaco(
  result: unknown,
  defaultRange: IRange,
  enums: { kinds: Record<string, number>; snippetRule: number }
): { suggestions: LspCompletionSuggestion[]; incomplete: boolean } {
  const list = asLspRecord(result)
  const items = readLspArray(result) ?? readLspArray(list?.items) ?? []
  const incomplete = list?.isIncomplete === true
  const suggestions = items.flatMap((raw) => {
    const suggestion = lspCompletionItemToSuggestion(raw, defaultRange, enums)
    return suggestion ? [suggestion] : []
  })
  return { suggestions, incomplete }
}

export type LspDiagnosticMarker = IRange & {
  severity: number
  message: string
  code?: string
  source?: string
}

function readDiagnosticCode(value: unknown): string | undefined {
  const scalar = typeof value === 'string' || typeof value === 'number' ? value : undefined
  const nested = asLspRecord(value)?.value
  const code =
    scalar ?? (typeof nested === 'string' || typeof nested === 'number' ? nested : undefined)
  return code === undefined ? undefined : String(code)
}

export function lspDiagnosticsToMonacoMarkers(
  diagnostics: unknown[],
  severities: { Error: number; Warning: number; Info: number; Hint: number }
): LspDiagnosticMarker[] {
  const severityByLspCode = [severities.Error, severities.Warning, severities.Info, severities.Hint]
  return diagnostics.flatMap((raw) => {
    const diagnostic = asLspRecord(raw)
    const range = readLspRange(diagnostic?.range)
    const message = readLspString(diagnostic?.message)
    if (!range || message === undefined) {
      return []
    }
    const marker: LspDiagnosticMarker = {
      ...lspRangeToMonaco(range),
      severity:
        severityByLspCode[(readLspNumber(diagnostic?.severity) ?? 1) - 1] ?? severities.Error,
      message
    }
    const code = readDiagnosticCode(diagnostic?.code)
    if (code !== undefined) {
      marker.code = code
    }
    const source = readLspString(diagnostic?.source)
    if (source) {
      marker.source = source
    }
    return [marker]
  })
}

/** Pull-diagnostics response (textDocument/diagnostic) → diagnostic items.
 *  Null means "keep the current markers" (kind: 'unchanged' or malformed). */
export function lspPullDiagnosticsToItems(result: unknown): unknown[] | null {
  const report = asLspRecord(result)
  return report?.kind === 'full' ? (readLspArray(report.items) ?? null) : null
}

/** file:// URI → local absolute path (posix or Windows). Null for anything else. */
export function fileUriToPath(uri: string): string | null {
  const match = /^file:\/\/(?<host>[^/]*)(?<path>\/.*)$/i.exec(uri)
  if (!match?.groups) {
    return null
  }
  const host = match.groups.host
  if (host && host !== 'localhost') {
    return null
  }
  let decoded: string
  try {
    decoded = decodeURIComponent(match.groups.path)
  } catch {
    return null
  }
  const driveMatch = /^\/([A-Za-z]:)(\/.*)?$/.exec(decoded)
  if (driveMatch) {
    return `${driveMatch[1]}${(driveMatch[2] ?? '/').replace(/\//g, '\\')}`
  }
  return decoded
}
