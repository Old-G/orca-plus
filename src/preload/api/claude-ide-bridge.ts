import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'
import type { ClaudeIdeRendererRequest } from '../../shared/claude-ide-bridge-types'

export const claudeIdeApi = {
  onRequest: (callback: (request: ClaudeIdeRendererRequest) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, request: ClaudeIdeRendererRequest): void =>
      callback(request)
    ipcRenderer.on('claudeIde:request', listener)
    return () => ipcRenderer.removeListener('claudeIde:request', listener)
  },
  respond: (response) => ipcRenderer.invoke('claudeIde:respond', response),
  reportSelection: (selection) => ipcRenderer.send('claudeIde:selectionChanged', selection),
  reportDiagnosticsChanged: (uris) => ipcRenderer.send('claudeIde:diagnosticsChanged', uris),
  mention: (request) => ipcRenderer.invoke('claudeIde:mention', request)
} satisfies PreloadApi['claudeIde']
