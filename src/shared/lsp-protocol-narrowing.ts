/** Checked readers for LSP JSON. A language server is another process, so every field is verified
 *  instead of asserted; a malformed field reads as absent rather than throwing downstream. */

export type LspPosition = { line: number; character: number }
export type LspRange = { start: LspPosition; end: LspPosition }

export function asLspRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null
}

export function readLspString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export function readLspNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function readLspArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined
}

export function readLspPosition(value: unknown): LspPosition | null {
  const record = asLspRecord(value)
  const line = readLspNumber(record?.line)
  const character = readLspNumber(record?.character)
  return line === undefined || character === undefined ? null : { line, character }
}

export function readLspRange(value: unknown): LspRange | null {
  const record = asLspRecord(value)
  const start = readLspPosition(record?.start)
  const end = readLspPosition(record?.end)
  return start && end ? { start, end } : null
}
