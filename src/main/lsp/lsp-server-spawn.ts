import { spawnProcess } from '../../shared/child-process/run-process'
import { resolveWindowsCommand } from '../win32-utils'
import type { LspServerDescriptor } from './lsp-server-catalog'

export type LspServerProcess = ReturnType<typeof spawnProcess>

export type SpawnLspServer = (descriptor: LspServerDescriptor, rootPath: string) => LspServerProcess

export const spawnLspServer: SpawnLspServer = (descriptor, rootPath) => {
  // Why: npm-installed servers are .cmd shims on Windows; spawnProcess needs an absolute
  // path there and resolves recognised shims to their real target itself.
  const child = spawnProcess({
    program: resolveWindowsCommand(descriptor.command),
    args: [...descriptor.args],
    cwd: rootPath,
    // Why: hydrateShellPath already merged the login-shell PATH into process.env.
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  // Why: nothing reads stderr; an undrained pipe blocks the server once the OS
  // buffer fills (rust-analyzer and gopls log there routinely).
  child.stderr.resume()
  return child
}
