import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocketTransport } from './ws-transport'

// Custom build (pwa): the installable web client's manifest, worker and icons.
describe('WebSocketTransport static web client PWA files', () => {
  const transports: WebSocketTransport[] = []

  afterEach(async () => {
    await Promise.all(transports.map((t) => t.stop().catch(() => {})))
    transports.length = 0
  })

  async function startWithPwaFiles(): Promise<number> {
    const staticRoot = mkdtempSync(join(tmpdir(), 'ws-transport-pwa-'))
    mkdirSync(join(staticRoot, 'pwa'))
    writeFileSync(join(staticRoot, 'web-index.html'), '<html>web</html>')
    writeFileSync(join(staticRoot, 'manifest.webmanifest'), '{"name":"Orca+"}')
    writeFileSync(join(staticRoot, 'sw.js'), 'self.addEventListener("install",()=>{})')
    writeFileSync(join(staticRoot, 'pwa', 'icon-192.png'), 'png')
    const transport = new WebSocketTransport({ host: '127.0.0.1', port: 0, staticRoot })
    transports.push(transport)
    await transport.start()
    return transport.resolvedPort
  }

  it.each(['', '/orca'])('serves the manifest, worker and icons under "%s"', async (prefix) => {
    const port = await startWithPwaFiles()
    const base = `http://127.0.0.1:${port}${prefix}`

    const manifest = await fetch(`${base}/manifest.webmanifest`)
    expect(manifest.status).toBe(200)
    expect(manifest.headers.get('content-type')).toContain('application/manifest+json')
    await expect(manifest.json()).resolves.toEqual({ name: 'Orca+' })

    const worker = await fetch(`${base}/sw.js`)
    expect(worker.status).toBe(200)
    expect(worker.headers.get('content-type')).toContain('text/javascript')
    // Why: a cached worker would pin phones to an old web client after an update.
    expect(worker.headers.get('cache-control')).toBe('no-cache')

    const icon = await fetch(`${base}/pwa/icon-192.png`)
    expect(icon.status).toBe(200)
    expect(icon.headers.get('content-type')).toBe('image/png')
  })

  it('still hides files outside the allowed set', async () => {
    const port = await startWithPwaFiles()
    expect((await fetch(`http://127.0.0.1:${port}/pwa.json`)).status).toBe(404)
    expect((await fetch(`http://127.0.0.1:${port}/sw.js.map`)).status).toBe(404)
  })
})
