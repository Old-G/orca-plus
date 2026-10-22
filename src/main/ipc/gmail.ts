// Custom build (hq-mail-intake): Settings' Gmail row — the client file, Google sign-in, status.
import { readFile } from 'node:fs/promises'
import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import type { GmailResult } from '../../shared/gmail-types'
import {
  connectGmail,
  disconnectGmail,
  getGmailStatus,
  importGmailClient
} from '../gmail/gmail-api'

export function registerGmailHandlers(): void {
  ipcMain.handle('gmail:status', () => getGmailStatus())

  ipcMain.handle('gmail:importClient', async (event): Promise<GmailResult | null> => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const options = {
      title: 'Google OAuth client (Desktop app)',
      properties: ['openFile' as const],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    }
    const picked = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    const path = picked.filePaths[0]
    if (picked.canceled || !path) {
      return null
    }
    return importGmailClient(await readFile(path, 'utf-8'))
  })

  ipcMain.handle('gmail:connect', async (): Promise<GmailResult> => {
    const result = await connectGmail((url) => shell.openExternal(url))
    return result.ok ? { ok: true } : result
  })

  ipcMain.handle('gmail:disconnect', () => disconnectGmail())
}
