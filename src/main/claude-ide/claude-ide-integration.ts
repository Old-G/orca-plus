import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type {
  ClaudeIdeMentionRequest,
  ClaudeIdeMentionResult,
  ClaudeIdeSelection
} from '../../shared/claude-ide-bridge-types'
import {
  isClaudeIdeClientFromOtherOrca,
  readClaudeIdeClientEnvironment,
  readClaudeIdeClientTerminal
} from './claude-ide-client-terminal'
import { chooseClaudeIdeMentionTarget } from './claude-ide-mention-target'
import {
  removeClaudeIdeLockFile,
  removeStaleClaudeIdeLockFiles,
  resolveClaudeIdeLockDir,
  writeClaudeIdeLockFile
} from './claude-ide-lock-file'
import { getSharedLspSessionManager } from '../ipc/lsp'
import { createClaudeIdeDiagnosticsSource } from './claude-ide-diagnostics-source'
import { ClaudeIdeRendererBridge } from './claude-ide-renderer-bridge'
import { setActiveClaudeIdeServer } from './claude-ide-hooks'
import { createClaudeIdeToolExecutor } from './claude-ide-tool-executor'
import { ClaudeIdeWsServer } from './claude-ide-ws-server'

// Orca as a Claude Code IDE, the way the VS Code extension does it: terminals get
// CLAUDE_CODE_SSE_PORT + a lock file and connect over WebSocket; the structured
// (native) chat runs through the SDK, which ignores IDE sockets, so it gets the
// same tools as an in-process MCP server named `ide`.

export const CLAUDE_IDE_NAME = 'Orca'
const PORT_FILE = 'claude-ide-server.json'
const RANDOM_PORT_ATTEMPTS = 10
// Why: folders only matter for `--ide` discovery by CLIs started outside Orca, so
// polling the renderer keeps the store free of another app-lifetime subscription.
const WORKSPACE_FOLDERS_REFRESH_MS = 30_000

const bridge = new ClaudeIdeRendererBridge()
let latestSelection: ClaudeIdeSelection | null = null
let workspaceFolders: string[] = []
let server: ClaudeIdeWsServer | null = null
let listeningPort: number | null = null
let authToken: string | null = null
let started = false

const getDiagnostics = createClaudeIdeDiagnosticsSource({
  askRenderer: (params) => bridge.ask('getDiagnostics', params, { waitForUser: false }),
  workspaceFolders: () => workspaceFolders,
  getLspManager: getSharedLspSessionManager
})

const callTool = createClaudeIdeToolExecutor({
  askRenderer: (method, params, options) =>
    method === 'getDiagnostics' ? getDiagnostics(params) : bridge.ask(method, params, options),
  latestSelection: () => latestSelection
})

function randomPort(): number {
  return Math.floor(Math.random() * 55_536) + 10_000
}

function readPreferredPort(portFile: string): number | null {
  try {
    const port: unknown = JSON.parse(readFileSync(portFile, 'utf8')).port
    return typeof port === 'number' && Number.isInteger(port) ? port : null
  } catch {
    return null
  }
}

async function refreshWorkspaceFolders(): Promise<void> {
  try {
    const reply: { folders?: { path?: unknown }[] } = JSON.parse(
      await bridge.ask('getWorkspaceFolders', {}, { waitForUser: false })
    )
    const next = (reply.folders ?? [])
      .map((folder) => folder.path)
      .filter((path): path is string => typeof path === 'string')
    if (JSON.stringify(next) !== JSON.stringify(workspaceFolders)) {
      workspaceFolders = next
      writeLock()
    }
  } catch {
    // Window not ready or reloading; the next tick retries.
  }
}

function writeLock(): void {
  if (listeningPort === null || authToken === null) {
    return
  }
  writeClaudeIdeLockFile(resolveClaudeIdeLockDir(), listeningPort, {
    pid: process.pid,
    workspaceFolders,
    ideName: CLAUDE_IDE_NAME,
    transport: 'ws',
    runningInWindows: process.platform === 'win32',
    authToken
  })
}

async function startServer(): Promise<void> {
  const token = randomUUID()
  const wsServer = new ClaudeIdeWsServer({
    authToken: token,
    serverName: `${CLAUDE_IDE_NAME} Claude Code MCP`,
    serverVersion: app.getVersion(),
    callTool,
    acceptClient: async (pid) => {
      const entries = await readClaudeIdeClientEnvironment(pid)
      return !entries || !isClaudeIdeClientFromOtherOrca(entries, app.getPath('userData'))
    },
    onClientReady: (notify) => {
      if (latestSelection) {
        notify('selection_changed', latestSelection)
      }
    }
  })
  const portFile = join(app.getPath('userData'), PORT_FILE)
  // Why: daemon-hosted terminals outlive the app and keep the port they were
  // spawned with, so reuse it across restarts whenever it is still free.
  const candidates = [
    readPreferredPort(portFile),
    ...Array.from({ length: RANDOM_PORT_ATTEMPTS }, randomPort)
  ]
  for (const candidate of candidates) {
    if (candidate === null) {
      continue
    }
    try {
      listeningPort = await wsServer.listen(candidate)
      break
    } catch {
      // Port taken: try the next candidate.
    }
  }
  if (listeningPort === null) {
    console.warn('[claude-ide] no free loopback port; IDE integration disabled')
    return
  }
  server = wsServer
  authToken = token
  setActiveClaudeIdeServer({
    port: listeningPort,
    version: app.getVersion(),
    callTool
  })
  const lockDir = resolveClaudeIdeLockDir()
  removeStaleClaudeIdeLockFiles(lockDir, CLAUDE_IDE_NAME)
  writeLock()
  try {
    writeFileSync(portFile, JSON.stringify({ port: listeningPort }))
  } catch (error) {
    console.warn('[claude-ide] could not persist port:', error)
  }
  void refreshWorkspaceFolders()
  const folderTimer = setInterval(
    () => void refreshWorkspaceFolders(),
    WORKSPACE_FOLDERS_REFRESH_MS
  )
  folderTimer.unref()
  app.once('will-quit', () => {
    clearInterval(folderTimer)
    setActiveClaudeIdeServer(null)
    if (listeningPort !== null) {
      removeClaudeIdeLockFile(lockDir, listeningPort)
    }
    server?.close()
  })
}

async function mentionInClaude(request: ClaudeIdeMentionRequest): Promise<ClaudeIdeMentionResult> {
  const clients = await Promise.all(
    (server?.clients() ?? []).map(async (client) => ({
      ...client,
      terminal: client.pid === undefined ? null : await readClaudeIdeClientTerminal(client.pid)
    }))
  )
  const target = chooseClaudeIdeMentionTarget(clients, request.worktreeId)
  if (!target) {
    return { delivered: false }
  }
  target.notify('at_mentioned', {
    filePath: request.filePath,
    ...(request.lineStart === undefined ? {} : { lineStart: request.lineStart }),
    ...(request.lineEnd === undefined ? {} : { lineEnd: request.lineEnd })
  })
  return {
    delivered: true,
    ...(target.terminal?.tabId ? { tabId: target.terminal.tabId } : {}),
    ...(target.terminal?.worktreeId ? { worktreeId: target.terminal.worktreeId } : {})
  }
}

/** Idempotent; later calls only retarget the trusted editor window (macOS re-opens windows). */
export function registerClaudeIdeIntegration(mainWindowWebContentsId: number | null): void {
  bridge.setTrustedWebContentsId(mainWindowWebContentsId)
  if (started) {
    return
  }
  started = true
  bridge.register({
    onSelectionChanged: (selection) => {
      if (!selection) {
        return
      }
      latestSelection = selection
      server?.broadcast('selection_changed', selection)
    },
    onDiagnosticsChanged: (uris) => server?.broadcast('diagnostics_changed', { uris }),
    onMention: mentionInClaude
  })
  void startServer().catch((error) => console.warn('[claude-ide] failed to start:', error))
}
