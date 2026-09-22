import { describe, expect, it, vi } from 'vitest'
import {
  CLIPBOARD_FILE_LIST_MAX_BYTES,
  readFilesFromClipboard,
  runClipboardCommandCapture,
  type ClipboardFileReadDeps
} from './clipboard-file-read'

function makeDeps(overrides: Partial<ClipboardFileReadDeps> = {}): ClipboardFileReadDeps {
  return {
    platform: 'darwin',
    desktop: undefined,
    readBuffer: vi.fn(() => Buffer.alloc(0)),
    runCommand: vi.fn(async () => ''),
    ...overrides
  }
}

describe('readFilesFromClipboard', () => {
  it('returns no files when the clipboard has no file payload', async () => {
    expect(await readFilesFromClipboard(makeDeps())).toEqual({ ok: true, filePaths: [] })
  })

  it('reads a public.file-url buffer on macOS', async () => {
    const result = await readFilesFromClipboard(
      makeDeps({
        platform: 'darwin',
        readBuffer: (format) =>
          format === 'public.file-url'
            ? Buffer.from('file:///repo/a%20b.png\0', 'utf8')
            : Buffer.alloc(0)
      })
    )
    expect(result).toEqual({ ok: true, filePaths: ['/repo/a b.png'] })
  })

  // Finder's real Cmd+C payload: public.file-url holds a file *reference* URL (inode id) that Node
  // cannot open, while NSFilenamesPboardType holds the real paths of every copied item.
  function finderClipboard(filenamesPlist: string | null): (format: string) => Buffer {
    return (format) => {
      if (format === 'public.file-url') {
        return Buffer.from('file:///.file/id=6571367.337692189', 'utf8')
      }
      if (format === 'NSFilenamesPboardType' && filenamesPlist !== null) {
        return Buffer.from(filenamesPlist, 'utf8')
      }
      return Buffer.alloc(0)
    }
  }
  const plist = (paths: string[]): string =>
    `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<array>\n${paths
      .map((p) => `\t<string>${p}</string>`)
      .join('\n')}\n</array>\n</plist>\n`

  it('reads real paths from a Finder copy instead of the file reference URL', async () => {
    const result = await readFilesFromClipboard(
      makeDeps({
        readBuffer: finderClipboard(
          plist(['/Users/me/Downloads/CV.pdf', '/Users/me/R&amp;D/a &lt;b&gt;.txt'])
        )
      })
    )
    expect(result).toEqual({
      ok: true,
      filePaths: ['/Users/me/Downloads/CV.pdf', '/Users/me/R&D/a <b>.txt']
    })
  })

  it('drops an unresolvable file reference URL rather than returning a broken path', async () => {
    const result = await readFilesFromClipboard(makeDeps({ readBuffer: finderClipboard(null) }))
    expect(result).toEqual({ ok: true, filePaths: [] })
  })

  it('ignores non-file clipboard text on macOS', async () => {
    const result = await readFilesFromClipboard(
      makeDeps({
        platform: 'darwin',
        readBuffer: (format) =>
          format === 'public.file-url' ? Buffer.from('just some text', 'utf8') : Buffer.alloc(0)
      })
    )
    expect(result).toEqual({ ok: true, filePaths: [] })
  })

  it('reads FileNameW paths on Windows', async () => {
    const result = await readFilesFromClipboard(
      makeDeps({
        platform: 'win32',
        readBuffer: (format) =>
          format === 'FileNameW' ? Buffer.from('C:\\repo\\notes.txt\0', 'utf16le') : Buffer.alloc(0)
      })
    )
    expect(result).toEqual({ ok: true, filePaths: ['C:\\repo\\notes.txt'] })
  })

  it('reads the GNOME copied-files payload on non-KDE desktops', async () => {
    const runCommand = vi.fn(async (command: string, args: string[]) => {
      if (command === 'wl-paste' && args.includes('x-special/gnome-copied-files')) {
        return 'copy\nfile:///repo/a.png'
      }
      throw new Error('missing format')
    })
    expect(
      await readFilesFromClipboard(makeDeps({ platform: 'linux', desktop: 'GNOME', runCommand }))
    ).toEqual({ ok: true, filePaths: ['/repo/a.png'] })
  })

  it('reads the KDE text/uri-list payload first on a KDE desktop', async () => {
    const runCommand = vi.fn(async (command: string, args: string[]) => {
      if (command === 'wl-paste' && args.includes('text/uri-list')) {
        return 'file:///repo/a%20b.png\r\n'
      }
      throw new Error('missing format')
    })
    expect(
      await readFilesFromClipboard(makeDeps({ platform: 'linux', desktop: 'KDE', runCommand }))
    ).toEqual({ ok: true, filePaths: ['/repo/a b.png'] })
  })

  it('prefers an Electron buffer over spawning a Linux clipboard tool', async () => {
    const runCommand = vi.fn(async () => {
      throw new Error('should not run')
    })
    expect(
      await readFilesFromClipboard(
        makeDeps({
          platform: 'linux',
          desktop: 'GNOME',
          readBuffer: (format) =>
            format === 'x-special/gnome-copied-files'
              ? Buffer.from('copy\nfile:///repo/from-electron.ts', 'utf8')
              : Buffer.alloc(0),
          runCommand
        })
      )
    ).toEqual({ ok: true, filePaths: ['/repo/from-electron.ts'] })
    expect(runCommand).not.toHaveBeenCalled()
  })

  it('returns no files when every Linux clipboard tool is unavailable', async () => {
    const runCommand = vi.fn(async () => {
      throw new Error('command not found')
    })
    expect(await readFilesFromClipboard(makeDeps({ platform: 'linux', runCommand }))).toEqual({
      ok: true,
      filePaths: []
    })
  })

  it('does not treat a clipboard read throw as a hard failure', async () => {
    expect(
      await readFilesFromClipboard(
        makeDeps({
          readBuffer: () => {
            throw new Error('clipboard unavailable')
          }
        })
      )
    ).toEqual({ ok: true, filePaths: [] })
  })
})

describe('runClipboardCommandCapture', () => {
  it('rejects after the byte cap instead of buffering the whole payload', async () => {
    await expect(
      runClipboardCommandCapture(process.execPath, [
        '-e',
        `process.stdout.write('x'.repeat(${CLIPBOARD_FILE_LIST_MAX_BYTES + 1}))`
      ])
    ).rejects.toThrow(/exceeded/)
  })

  it('rejects when the command exceeds the timeout', async () => {
    await expect(
      runClipboardCommandCapture(process.execPath, ['-e', 'setTimeout(() => {}, 10_000)'])
    ).rejects.toThrow(/timed out/)
  }, 8_000)
})
