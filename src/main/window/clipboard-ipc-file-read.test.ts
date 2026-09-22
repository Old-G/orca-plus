import { beforeEach, describe, expect, it, vi } from 'vitest'

const { handlers, clipboardReadBuffer } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  clipboardReadBuffer: vi.fn((_format: string) => Buffer.alloc(0))
}))

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp') },
  clipboard: {
    readText: vi.fn(() => ''),
    readBuffer: clipboardReadBuffer,
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
vi.mock('./clipboard-remote-file-copy', () => ({
  cleanupExpiredRemoteClipboardFiles: vi.fn(async () => undefined),
  scheduleLegacyRemoteClipboardFileCleanup: vi.fn(),
  writeRemoteFileToClipboard: vi.fn()
}))

import {
  registerClipboardHandlers,
  setTrustedClipboardRendererWebContentsId
} from './clipboard-ipc-handlers'

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
    setTrustedClipboardRendererWebContentsId(null)
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
    expect(clipboardReadBuffer).not.toHaveBeenCalled()
  })
})
