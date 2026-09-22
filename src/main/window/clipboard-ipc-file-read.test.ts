import { beforeEach, describe, expect, it, vi } from 'vitest'

const { handlers, clipboardReadBuffer, clipboardRead } = vi.hoisted(() => {
  const clipboardReadBuffer = vi.fn((_format: string) => Buffer.alloc(0))
  const formats = [
    'NSFilenamesPboardType',
    'public.file-url',
    'FileNameW',
    'x-special/gnome-copied-files',
    'text/uri-list'
  ]
  return {
    handlers: new Map<string, (...args: unknown[]) => unknown>(),
    clipboardReadBuffer,
    // Why: Electron 45 reads native formats through clipboard.read() items, not readBuffer.
    clipboardRead: vi.fn(async () =>
      formats
        .map((format) => ({ format, bytes: clipboardReadBuffer(format) }))
        .filter(({ bytes }) => bytes.byteLength > 0)
        .map(({ format, bytes }) => ({
          types: [format],
          getType: async () => new Blob([new Uint8Array(bytes)])
        }))
    )
  }
})

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp') },
  clipboard: {
    readText: vi.fn(() => ''),
    read: clipboardRead,
    writeText: vi.fn(),
    readImage: vi.fn(),
    writeImage: vi.fn(),
    writeBuffer: vi.fn()
  },
  ipcMain: {
    removeHandler: (channel: string) => handlers.delete(channel),
    handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
      handlers.set(channel, handler)
  },
  nativeImage: { createFromBuffer: vi.fn() }
}))

vi.mock('./dashboard-popout-window', () => ({ isDashboardPopoutRenderer: () => false }))
vi.mock('./clipboard/clipboard-remote-file-copy', () => ({
  cleanupExpiredRemoteClipboardFiles: vi.fn(async () => undefined),
  scheduleLegacyRemoteClipboardFileCleanup: vi.fn(),
  writeRemoteFileToClipboard: vi.fn()
}))

import { registerClipboardHandlers } from './clipboard/clipboard-ipc-handlers'
import { setTrustedClipboardRendererWebContentsId } from './clipboard/clipboard-ipc-sender-trust'

function makeClipboardEvent(senderOverrides: Record<string, unknown> = {}): {
  sender: Record<string, unknown>
} {
  return {
    sender: {
      id: 17,
      getType: () => 'window',
      getURL: () => 'file:///orca/index.html',
      isDestroyed: () => false,
      ...senderOverrides
    }
  }
}

describe('clipboard:readFile IPC', () => {
  beforeEach(() => {
    handlers.clear()
    clipboardReadBuffer.mockReset()
    clipboardReadBuffer.mockReturnValue(Buffer.alloc(0))
    clipboardRead.mockClear()
    // Upstream trusts only the pinned main-window id outside a dev renderer URL.
    setTrustedClipboardRendererWebContentsId(17)
    registerClipboardHandlers({} as never)
  })

  it('reads a file from the OS clipboard', async () => {
    clipboardReadBuffer.mockImplementation((format: string) => {
      if (format === 'public.file-url') {
        return Buffer.from('file:///tmp/copied-file.txt', 'utf8')
      }
      if (format === 'FileNameW') {
        return Buffer.from('C:\\tmp\\copied-file.txt\0', 'utf16le')
      }
      if (format === 'x-special/gnome-copied-files') {
        return Buffer.from('copy\nfile:///tmp/copied-file.txt', 'utf8')
      }
      if (format === 'text/uri-list') {
        return Buffer.from('file:///tmp/copied-file.txt\r\n', 'utf8')
      }
      return Buffer.alloc(0)
    })

    await expect(handlers.get('clipboard:readFile')?.(makeClipboardEvent())).resolves.toEqual({
      ok: true,
      filePaths:
        process.platform === 'win32' ? ['C:\\tmp\\copied-file.txt'] : ['/tmp/copied-file.txt']
    })
  })

  it('returns no files when the OS clipboard has no file payload', async () => {
    await expect(handlers.get('clipboard:readFile')?.(makeClipboardEvent())).resolves.toEqual({
      ok: true,
      filePaths: []
    })
  })

  it('rejects clipboard file reads from untrusted renderers', () => {
    setTrustedClipboardRendererWebContentsId(17)
    registerClipboardHandlers({} as never)

    expect(() => handlers.get('clipboard:readFile')?.(makeClipboardEvent({ id: 42 }))).toThrow(
      'Unauthorized clipboard IPC sender'
    )
    expect(clipboardRead).not.toHaveBeenCalled()
  })
})
