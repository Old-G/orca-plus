import { isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  writeFileToClipboard,
  type ClipboardFileDeps,
  type ClipboardFileResult
} from './clipboard-file-copy'

export type ClipboardFilesResult = ClipboardFileResult & { filePaths?: string[] }

export const CLIPBOARD_FILES_WRITE_MAX = 1_000

const escapeXml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * Why NSFilenamesPboardType: it is the one pasteboard type that carries every path of a
 * multi-file copy inside a single item — what Electron's writeBuffer can write — and macOS
 * synthesizes public.file-url from it. Several NSURL items via NSPasteboard.writeObjects
 * (what Finder does) were tried from osascript and lost all but the first item whenever the
 * short-lived writer exited: the extra items are promised data owned by the writing process.
 */
export function macFilenamesPlist(paths: string[]): string {
  const strings = paths.map((path) => `<string>${escapeXml(path)}</string>`).join('')
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">' +
    `<plist version="1.0"><array>${strings}</array></plist>`
  )
}

/**
 * Put several file references on the OS clipboard, so a paste in Finder / Explorer /
 * a file manager — or back into the File Explorer — sees every file. One path goes
 * through the upstream single-file writer unchanged. Local files only. Resolves the
 * written (authorized) paths so a caller can recognise its own write on paste.
 */
export async function writeFilesToClipboard(
  filePaths: unknown,
  deps: ClipboardFileDeps
): Promise<ClipboardFilesResult> {
  const paths = Array.isArray(filePaths)
    ? filePaths.filter((path): path is string => typeof path === 'string' && isAbsolute(path))
    : []
  if (
    !Array.isArray(filePaths) ||
    paths.length === 0 ||
    paths.length !== filePaths.length ||
    paths.length > CLIPBOARD_FILES_WRITE_MAX
  ) {
    return { ok: false, reason: 'invalid-path' }
  }

  const resolved: string[] = []
  for (const filePath of paths) {
    const result = await deps.resolveFilePath(filePath)
    if (!result.ok) {
      return { ok: false, reason: result.reason }
    }
    resolved.push(result.path)
  }

  if (resolved.length === 1) {
    const single = await writeFileToClipboard(resolved[0], {
      ...deps,
      resolveFilePath: async () => ({ ok: true, path: resolved[0] })
    })
    return single.ok ? { ok: true, filePaths: resolved } : single
  }

  try {
    if (deps.platform === 'darwin') {
      deps.writeBuffer('NSFilenamesPboardType', Buffer.from(macFilenamesPlist(resolved), 'utf8'))
    } else if (deps.platform === 'win32') {
      const list = resolved.map((path) => `'${path.replace(/'/g, "''")}'`).join(',')
      await deps.runCommand('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Set-Clipboard -LiteralPath ${list}`
      ])
    } else if (!(await writeLinuxFileList(resolved, deps))) {
      return { ok: false, reason: 'unsupported-platform' }
    }
  } catch {
    return { ok: false, reason: 'clipboard-command-failed' }
  }
  return { ok: true, filePaths: resolved }
}

// Same desktop split as the single-file writer: KDE reads text/uri-list, the
// GNOME family reads the copy-verb payload.
async function writeLinuxFileList(paths: string[], deps: ClipboardFileDeps): Promise<boolean> {
  const urls = paths.map((path) => pathToFileURL(path).href)
  const [mime, payload] = /kde/i.test(deps.desktop ?? '')
    ? ['text/uri-list', `${urls.join('\r\n')}\r\n`]
    : ['x-special/gnome-copied-files', `copy\n${urls.join('\n')}`]
  for (const [command, args] of [
    ['wl-copy', ['--type', mime]],
    ['xclip', ['-selection', 'clipboard', '-t', mime]]
  ] as const) {
    try {
      await deps.runCommand(command, [...args], payload)
      return true
    } catch {
      // try the next tool
    }
  }
  return false
}
