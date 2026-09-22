import { fileURLToPath } from 'node:url'
import { runProcess } from '../../shared/child-process/run-process'

export type ClipboardFileReadResult = { ok: true; filePaths: string[] }

// Injected so the platform branching is unit-testable without the real OS clipboard.
export type ClipboardFileReadDeps = {
  platform: NodeJS.Platform
  desktop?: string
  readBuffer: (format: string) => Buffer
  runCommand: (command: string, args: string[]) => Promise<string>
}

export const CLIPBOARD_FILE_LIST_MAX_BYTES = 64 * 1024
export const CLIPBOARD_FILE_READ_TIMEOUT_MS = 2_000

export async function runClipboardCommandCapture(command: string, args: string[]): Promise<string> {
  const result = await runProcess({
    program: command,
    args,
    timeoutMs: CLIPBOARD_FILE_READ_TIMEOUT_MS,
    // Why +1: the runner clips at the cap, so one extra byte tells "too big" from "exactly full".
    maxOutputBytes: CLIPBOARD_FILE_LIST_MAX_BYTES + 1
  })
  if (result.timedOut) {
    throw new Error(`${command} timed out`)
  }
  if (result.outputTruncated || Buffer.byteLength(result.stdout) > CLIPBOARD_FILE_LIST_MAX_BYTES) {
    throw new Error(`${command} exceeded ${CLIPBOARD_FILE_LIST_MAX_BYTES} bytes`)
  }
  if (result.code !== 0) {
    throw new Error(`${command} exited with ${result.code}`)
  }
  return result.stdout
}

export async function readFilesFromClipboard(
  deps: ClipboardFileReadDeps
): Promise<ClipboardFileReadResult> {
  try {
    if (deps.platform === 'darwin') {
      return { ok: true, filePaths: readMacClipboardFiles(deps) }
    }
    if (deps.platform === 'win32') {
      return { ok: true, filePaths: readWindowsClipboardFiles(deps) }
    }
    return { ok: true, filePaths: await readLinuxClipboardFiles(deps) }
  } catch {
    return { ok: true, filePaths: [] }
  }
}

function readMacClipboardFiles(deps: ClipboardFileReadDeps): string[] {
  // Why: Finder writes a file *reference* URL (file:///.file/id=<fs>.<inode>) to public.file-url,
  // which Node cannot open (ENOTDIR). NSFilenamesPboardType carries the real POSIX paths — and every
  // item of a multi-file copy, where public.file-url holds only the first.
  const filenames = parseMacFilenamesPlist(readClipboardText(deps, 'NSFilenamesPboardType'))
  if (filenames.length > 0) {
    return filenames
  }
  return parseFileUrls(readClipboardText(deps, 'public.file-url')).filter(
    (filePath) => !isMacFileReferencePath(filePath)
  )
}

const MAC_FILE_REFERENCE_PREFIX = '/.file/id='

function isMacFileReferencePath(filePath: string): boolean {
  return filePath.startsWith(MAC_FILE_REFERENCE_PREFIX)
}

const PLIST_XML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'"
}

function parseMacFilenamesPlist(payload: string): string[] {
  const paths: string[] = []
  for (const match of payload.matchAll(/<string>([^<]*)<\/string>/gu)) {
    const decoded = match[1].replace(
      /&(amp|lt|gt|quot|apos);/gu,
      (_, name: string) => PLIST_XML_ENTITIES[name]
    )
    const filePath = usableClipboardPath(decoded)
    if (filePath && !isMacFileReferencePath(filePath) && !paths.includes(filePath)) {
      paths.push(filePath)
    }
  }
  return paths
}

function readWindowsClipboardFiles(deps: ClipboardFileReadDeps): string[] {
  return decodeFileNameWList(safeReadBuffer(deps, 'FileNameW'))
}

async function readLinuxClipboardFiles(deps: ClipboardFileReadDeps): Promise<string[]> {
  const mimeTypes = /kde/i.test(deps.desktop ?? '')
    ? (['text/uri-list', 'x-special/gnome-copied-files'] as const)
    : (['x-special/gnome-copied-files', 'text/uri-list'] as const)

  for (const mime of mimeTypes) {
    const fromElectron = parseLinuxClipboardPayload(readClipboardText(deps, mime), mime)
    if (fromElectron.length > 0) {
      return fromElectron
    }
    for (const [command, args] of [
      ['wl-paste', ['--type', mime, '--no-newline']],
      ['xclip', ['-selection', 'clipboard', '-t', mime, '-o']]
    ] as const) {
      try {
        const paths = parseLinuxClipboardPayload(await deps.runCommand(command, [...args]), mime)
        if (paths.length > 0) {
          return paths
        }
      } catch {
        // try the next tool
      }
    }
  }
  return []
}

function parseLinuxClipboardPayload(payload: string, mime: string): string[] {
  const text = payload.replace(/\0+$/u, '')
  if (!text.trim()) {
    return []
  }
  if (mime === 'x-special/gnome-copied-files') {
    const lines = text.split(/\r?\n/u)
    // Why: the first line is the copy/cut verb; explorer paste always copies.
    return parseFileUrls(lines.slice(1).join('\n'))
  }
  return parseFileUrls(text)
}

function parseFileUrls(payload: string): string[] {
  const paths: string[] = []
  for (const rawLine of payload.split(/\r?\n/u)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) {
      continue
    }
    const filePath = decodeClipboardFileReference(line)
    if (filePath && !paths.includes(filePath)) {
      paths.push(filePath)
    }
  }
  return paths
}

function decodeClipboardFileReference(value: string): string | null {
  if (value.startsWith('file:')) {
    try {
      return usableClipboardPath(fileURLToPath(value))
    } catch {
      return null
    }
  }
  return usableClipboardPath(value)
}

function decodeFileNameWList(value: Buffer): string[] {
  if (
    value.byteLength < 2 ||
    value.byteLength > CLIPBOARD_FILE_LIST_MAX_BYTES ||
    value.byteLength % 2 !== 0
  ) {
    return []
  }
  const paths: string[] = []
  let offset = 0
  while (offset + 2 <= value.byteLength) {
    let end = offset
    while (end + 2 <= value.byteLength && value.readUInt16LE(end) !== 0) {
      end += 2
    }
    if (end === offset) {
      break
    }
    const filePath = usableClipboardPath(value.subarray(offset, end).toString('utf16le'))
    if (filePath && !paths.includes(filePath)) {
      paths.push(filePath)
    }
    offset = end + 2
  }
  return paths
}

function usableClipboardPath(filePath: string): string | null {
  if (!filePath || filePath.includes('\0')) {
    return null
  }
  if (filePath.startsWith('/') || isFullyQualifiedWindowsPath(filePath)) {
    return filePath
  }
  return null
}

function isFullyQualifiedWindowsPath(filePath: string): boolean {
  if (/^[A-Za-z]:[\\/]/.test(filePath)) {
    return true
  }
  if (/^\\\\\?\\[A-Za-z]:\\/.test(filePath)) {
    return true
  }
  const extendedUnc = /^\\\\\?\\UNC\\[^\\/]+\\([^\\/]+)(?:\\|$)/i.exec(filePath)
  if (extendedUnc) {
    return isOrdinaryUncShare(extendedUnc[1])
  }
  const unc = /^[/\\]{2}(?![?.][/\\])[^/\\]+[/\\]([^/\\]+)(?:[/\\]|$)/.exec(filePath)
  return isOrdinaryUncShare(unc?.[1])
}

function isOrdinaryUncShare(share: string | undefined): boolean {
  return typeof share === 'string' && share.toLowerCase() !== 'pipe'
}

function readClipboardText(deps: ClipboardFileReadDeps, format: string): string {
  return stripTrailingNulls(safeReadBuffer(deps, format).toString('utf8'))
}

function safeReadBuffer(deps: ClipboardFileReadDeps, format: string): Buffer {
  try {
    const value = deps.readBuffer(format)
    if (!Buffer.isBuffer(value) || value.byteLength > CLIPBOARD_FILE_LIST_MAX_BYTES) {
      return Buffer.alloc(0)
    }
    return value
  } catch {
    return Buffer.alloc(0)
  }
}

function stripTrailingNulls(value: string): string {
  return value.replace(/\0+$/u, '')
}
