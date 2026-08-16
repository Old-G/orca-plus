import { ipcRenderer } from 'electron'
import type {
  LspChangeDocumentArgs,
  LspCloseDocumentArgs,
  LspDiagnosticsPayload,
  LspOpenDocumentArgs,
  LspOpenDocumentResult,
  LspRequestArgs
} from '../../shared/lsp-types'
import type { PreloadApi } from '../api-types'

export const lspApi = {
  openDocument: (args: LspOpenDocumentArgs): Promise<LspOpenDocumentResult> =>
    ipcRenderer.invoke('lsp:openDocument', args),
  changeDocument: (args: LspChangeDocumentArgs): Promise<void> =>
    ipcRenderer.invoke('lsp:changeDocument', args),
  closeDocument: (args: LspCloseDocumentArgs): Promise<void> =>
    ipcRenderer.invoke('lsp:closeDocument', args),
  request: (args: LspRequestArgs): Promise<unknown> => ipcRenderer.invoke('lsp:request', args),
  onDiagnostics: (callback: (payload: LspDiagnosticsPayload) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: LspDiagnosticsPayload): void =>
      callback(payload)
    ipcRenderer.on('lsp:diagnostics', listener)
    return () => ipcRenderer.removeListener('lsp:diagnostics', listener)
  }
} satisfies PreloadApi['lsp']
