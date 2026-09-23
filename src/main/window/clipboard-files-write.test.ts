import { describe, expect, it, vi } from 'vitest'
import type { ProcessResult } from '@orca/process-host/process-spec'
import type { ClipboardFileDeps } from './clipboard-file-copy'
import { macFilenamesPlist, writeFilesToClipboard } from './clipboard-files-write'

function exited(code: number | null): ProcessResult {
  return { code, signal: null, stdout: '', stderr: '', timedOut: false }
}

function makeDeps(overrides: Partial<ClipboardFileDeps> = {}): ClipboardFileDeps {
  return {
    platform: 'darwin',
    resolveFilePath: vi.fn(async (path: string) => ({ ok: true as const, path: `/real${path}` })),
    writeBuffer: vi.fn(),
    runProcess: vi.fn(async () => exited(0)),
    ...overrides
  }
}

describe('writeFilesToClipboard', () => {
  it.each([[[]], ['/a'], [['relative/a']], [[42]]])('rejects %j', async (input) => {
    const deps = makeDeps()
    expect(await writeFilesToClipboard(input, deps)).toEqual({ ok: false, reason: 'invalid-path' })
    expect(deps.runProcess).not.toHaveBeenCalled()
  })

  it('fails closed when any path is not authorized, before touching the clipboard', async () => {
    const deps = makeDeps({
      resolveFilePath: vi.fn(async (path: string) =>
        path === '/b'
          ? { ok: false as const, reason: 'access-denied' }
          : { ok: true as const, path }
      )
    })
    expect(await writeFilesToClipboard(['/a', '/b'], deps)).toEqual({
      ok: false,
      reason: 'access-denied'
    })
    expect(deps.runProcess).not.toHaveBeenCalled()
    expect(deps.writeBuffer).not.toHaveBeenCalled()
  })

  it('writes one file through the single-file writer and returns the resolved path', async () => {
    const deps = makeDeps()
    expect(await writeFilesToClipboard(['/a'], deps)).toEqual({ ok: true, filePaths: ['/real/a'] })
    expect(deps.writeBuffer).toHaveBeenCalledWith('public.file-url', Buffer.from('file:///real/a'))
    expect(deps.runProcess).not.toHaveBeenCalled()
  })

  it('writes several files on macOS as one NSFilenamesPboardType plist', async () => {
    const deps = makeDeps()
    const result = await writeFilesToClipboard(['/a', "/b c'd"], deps)
    expect(result).toEqual({ ok: true, filePaths: ['/real/a', "/real/b c'd"] })
    expect(deps.writeBuffer).toHaveBeenCalledWith(
      'NSFilenamesPboardType',
      Buffer.from(macFilenamesPlist(['/real/a', "/real/b c'd"]), 'utf8')
    )
    expect(deps.runProcess).not.toHaveBeenCalled()
  })

  it('escapes XML in the macOS plist', () => {
    expect(macFilenamesPlist(['/x/a&b<c>.txt'])).toContain(
      '<array><string>/x/a&amp;b&lt;c&gt;.txt</string></array>'
    )
  })

  it('reports a macOS clipboard write that throws', async () => {
    const deps = makeDeps({
      writeBuffer: vi.fn(() => {
        throw new Error('pasteboard')
      })
    })
    expect(await writeFilesToClipboard(['/a', '/b'], deps)).toEqual({
      ok: false,
      reason: 'clipboard-command-failed'
    })
  })

  it('hands several files to Set-Clipboard on Windows through the environment, not the script', async () => {
    const deps = makeDeps({ platform: 'win32' })
    await writeFilesToClipboard(['/a', "/it's"], deps)
    expect(deps.runProcess).toHaveBeenCalledWith(
      expect.objectContaining({
        args: [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          'Set-Clipboard -LiteralPath ($env:ORCA_CLIPBOARD_FILES -split [char]10)'
        ],
        env: expect.objectContaining({ ORCA_CLIPBOARD_FILES: "/real/a\n/real/it's" })
      })
    )
  })

  it('writes several files on GNOME as one copied-files payload, falling back to xclip', async () => {
    const runProcess = vi
      .fn<ClipboardFileDeps['runProcess']>()
      .mockResolvedValueOnce(exited(127))
      .mockResolvedValueOnce(exited(0))
    const deps = makeDeps({ platform: 'linux', desktop: 'GNOME', runProcess })
    expect((await writeFilesToClipboard(['/a', '/b'], deps)).ok).toBe(true)
    expect(runProcess).toHaveBeenLastCalledWith(
      expect.objectContaining({
        program: 'xclip',
        args: ['-selection', 'clipboard', '-t', 'x-special/gnome-copied-files'],
        input: 'copy\nfile:///real/a\nfile:///real/b'
      })
    )
  })

  it('writes several files on KDE as a uri-list', async () => {
    const deps = makeDeps({ platform: 'linux', desktop: 'KDE' })
    await writeFilesToClipboard(['/a', '/b'], deps)
    expect(deps.runProcess).toHaveBeenCalledWith(
      expect.objectContaining({
        program: 'wl-copy',
        args: ['--type', 'text/uri-list'],
        input: 'file:///real/a\r\nfile:///real/b\r\n'
      })
    )
  })

  it('reports a failed clipboard command instead of throwing', async () => {
    const deps = makeDeps({
      platform: 'win32',
      runProcess: vi.fn().mockRejectedValue(new Error('boom'))
    })
    expect(await writeFilesToClipboard(['/a', '/b'], deps)).toEqual({
      ok: false,
      reason: 'clipboard-command-failed'
    })
  })
})
