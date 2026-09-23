import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LspDiagnosticsListener, LspSessionManager } from '../lsp/lsp-session-manager'
import { createClaudeIdeDiagnosticsSource } from './claude-ide-diagnostics-source'

const dirs: string[] = []
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })))

function workspace(): { root: string; file: string } {
  const root = mkdtempSync(join(tmpdir(), 'claude-ide-diag-'))
  dirs.push(root)
  const file = join(root, 'main.ts')
  writeFileSync(file, 'const x: string = 1\n')
  return { root, file }
}

const lspError = {
  message: "Type 'number' is not assignable to type 'string'.",
  severity: 1,
  range: { start: { line: 0, character: 6 }, end: { line: 0, character: 7 } },
  source: 'ts',
  code: 2322
}

function fakeManager(mode: 'pull' | 'push') {
  const listeners = new Set<LspDiagnosticsListener>()
  const manager = {
    openDocument: vi.fn(async (args: { filePath: string }) => {
      const fileUri = pathToFileURL(args.filePath).toString()
      if (mode === 'push') {
        setTimeout(
          () =>
            listeners.forEach((listener) =>
              listener({ sessionId: 's1', fileUri, diagnostics: [lspError] })
            ),
          5
        )
      }
      return { sessionId: 's1', fileUri, serverId: 'tsgo', pullDiagnostics: mode === 'pull' }
    }),
    request: vi.fn(async () => ({ kind: 'full', items: [lspError] })),
    closeDocument: vi.fn(),
    onDiagnostics: (listener: LspDiagnosticsListener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    changeDocument: vi.fn(),
    disposeAll: vi.fn()
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the fake implements every method the source calls.
  return manager as unknown as LspSessionManager & typeof manager
}

describe('claude IDE diagnostics source', () => {
  it('uses renderer markers while a mounted editor keeps them current', async () => {
    const { root, file } = workspace()
    const manager = fakeManager('pull')
    const getDiagnostics = createClaudeIdeDiagnosticsSource({
      askRenderer: async () =>
        JSON.stringify([{ uri: pathToFileURL(file).toString(), live: true, diagnostics: [] }]),
      workspaceFolders: () => [root],
      getLspManager: () => manager
    })
    const result = JSON.parse(await getDiagnostics({ uri: pathToFileURL(file).toString() }))
    expect(result).toEqual([{ uri: pathToFileURL(file).toString(), diagnostics: [] }])
    expect(manager.openDocument).not.toHaveBeenCalled()
  })

  it.each(['pull', 'push'] as const)(
    'asks the LSP server (%s model) for a file no editor shows, in VS Code shape',
    async (mode) => {
      const { root, file } = workspace()
      const manager = fakeManager(mode)
      const getDiagnostics = createClaudeIdeDiagnosticsSource({
        askRenderer: async () => '[]',
        workspaceFolders: () => [root],
        getLspManager: () => manager
      })
      const [entry] = JSON.parse(await getDiagnostics({ uri: pathToFileURL(file).toString() }))
      expect(entry).toEqual({
        uri: pathToFileURL(file).toString(),
        linesInFile: 2,
        diagnostics: [
          {
            message: lspError.message,
            severity: 'Error',
            range: lspError.range,
            source: 'ts',
            code: '2322'
          }
        ]
      })
      expect(manager.openDocument).toHaveBeenCalledWith(
        expect.objectContaining({ filePath: file, rootPath: root, languageId: 'typescript' })
      )
      expect(manager.closeDocument).toHaveBeenCalledWith('s1', pathToFileURL(file).toString())
    }
  )

  it('never starts a server for files outside the known workspaces', async () => {
    const { file } = workspace()
    const manager = fakeManager('pull')
    const getDiagnostics = createClaudeIdeDiagnosticsSource({
      askRenderer: async () => '[]',
      workspaceFolders: () => ['/somewhere/else'],
      getLspManager: () => manager
    })
    expect(JSON.parse(await getDiagnostics({ uri: pathToFileURL(file).toString() }))).toEqual([])
    expect(manager.openDocument).not.toHaveBeenCalled()
  })
})
