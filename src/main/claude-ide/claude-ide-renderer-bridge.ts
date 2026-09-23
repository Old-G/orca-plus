import { randomUUID } from 'node:crypto'
import { ipcMain, webContents, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import type {
  ClaudeIdeMentionRequest,
  ClaudeIdeMentionResult,
  ClaudeIdeRendererMethod,
  ClaudeIdeRendererResponse,
  ClaudeIdeSelection
} from '../../shared/claude-ide-bridge-types'
import type { ClaudeIdeAskOptions } from './claude-ide-tool-executor'

const RENDERER_REQUEST_TIMEOUT_MS = 10_000

type Pending = {
  resolve: (text: string) => void
  reject: (error: Error) => void
  /** Clears the timeout or the window-lifecycle listeners. */
  cleanup: () => void
}

export type ClaudeIdeRendererEvents = {
  onSelectionChanged: (selection: ClaudeIdeSelection | null) => void
  onDiagnosticsChanged: (uris: string[]) => void
  onMention: (request: ClaudeIdeMentionRequest) => Promise<ClaudeIdeMentionResult>
}

/** Main-side end of the editor-state bridge; only the trusted main window may answer. */
export class ClaudeIdeRendererBridge {
  private trustedWebContentsId: number | null = null
  private readonly pending = new Map<string, Pending>()
  private registered = false

  setTrustedWebContentsId(id: number | null): void {
    this.trustedWebContentsId = id
  }

  register(events: ClaudeIdeRendererEvents): void {
    if (this.registered) {
      return
    }
    this.registered = true
    ipcMain.handle(
      'claudeIde:respond',
      (event: IpcMainInvokeEvent, response: ClaudeIdeRendererResponse) => {
        if (!this.isTrusted(event)) {
          return
        }
        const pending = this.pending.get(response.requestId)
        if (!pending) {
          return
        }
        this.pending.delete(response.requestId)
        pending.cleanup()
        if (response.ok) {
          pending.resolve(response.text)
        } else {
          pending.reject(new Error(response.error))
        }
      }
    )
    ipcMain.on('claudeIde:selectionChanged', (event, selection: ClaudeIdeSelection | null) => {
      if (this.isTrusted(event)) {
        events.onSelectionChanged(selection)
      }
    })
    ipcMain.handle(
      'claudeIde:mention',
      async (event: IpcMainInvokeEvent, request: ClaudeIdeMentionRequest) =>
        this.isTrusted(event) && typeof request?.filePath === 'string'
          ? events.onMention(request)
          : { delivered: false }
    )
    ipcMain.on('claudeIde:diagnosticsChanged', (event, uris: string[]) => {
      if (this.isTrusted(event) && Array.isArray(uris)) {
        events.onDiagnosticsChanged(uris)
      }
    })
  }

  private isTrusted(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
    return this.trustedWebContentsId !== null && event.sender.id === this.trustedWebContentsId
  }

  ask(
    method: ClaudeIdeRendererMethod,
    params: Record<string, unknown>,
    options: ClaudeIdeAskOptions
  ): Promise<string> {
    const target =
      this.trustedWebContentsId === null ? undefined : webContents.fromId(this.trustedWebContentsId)
    if (!target || target.isDestroyed()) {
      return Promise.reject(new Error('Orca editor window is not available'))
    }
    const requestId = randomUUID()
    return new Promise((resolve, reject) => {
      const fail = (message: string): void => {
        const pending = this.pending.get(requestId)
        if (pending) {
          this.pending.delete(requestId)
          pending.cleanup()
          reject(new Error(message))
        }
      }
      let cleanup: () => void
      if (options.waitForUser) {
        // Why: a user decision has no deadline, but a reload or closed window loses the editor's
        // side of the request; failing lets the CLI fall back to its terminal prompt.
        const onGone = (): void => fail('Orca editor window reloaded or closed')
        target.once('did-start-loading', onGone)
        target.once('destroyed', onGone)
        cleanup = () => {
          target.off('did-start-loading', onGone)
          target.off('destroyed', onGone)
        }
      } else {
        const timer = setTimeout(
          () => fail(`Orca editor did not answer ${method} in time`),
          RENDERER_REQUEST_TIMEOUT_MS
        )
        cleanup = () => clearTimeout(timer)
      }
      this.pending.set(requestId, { resolve, reject, cleanup })
      target.send('claudeIde:request', { requestId, method, params })
    })
  }
}
