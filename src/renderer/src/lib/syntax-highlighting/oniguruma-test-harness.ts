// Custom build (chat-code-theme): upstream removed this test helper (#46786); syntax-highlighter-theme-override.test.ts still uses it.
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import type { Oniguruma } from './oniguruma'

let nodeOnigurumaPromise: Promise<Oniguruma> | undefined

/** The bundled Oniguruma WASM read from disk, for tests running outside a browser. */
export function loadNodeOniguruma(): Promise<Oniguruma> {
  nodeOnigurumaPromise ??= (async () => {
    const oniguruma = await import('vscode-oniguruma')
    const wasm = await readFile(
      createRequire(import.meta.url).resolve('vscode-oniguruma/release/onig.wasm')
    )
    await oniguruma.loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength))
    return oniguruma
  })()
  return nodeOnigurumaPromise
}
