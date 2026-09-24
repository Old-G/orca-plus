import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setMainHttpClient } from '../network/http-client'
import { downloadOpenVsxExtension, searchOpenVsxThemes } from './open-vsx-client'

function useResponses(responses: Record<string, Response>): ReturnType<typeof vi.fn> {
  const fetch = vi.fn(
    async (url: string) => responses[url] ?? new Response('missing', { status: 404 })
  )
  setMainHttpClient({ fetch, proxySession: () => null })
  return fetch
}

const API = 'https://open-vsx.org/api'
const VSIX = Buffer.from('vsix-bytes')
const SHA = createHash('sha256').update(VSIX).digest('hex')

function meta(): Response {
  return Response.json({
    version: '1.5.2',
    files: { download: `${API}/d/r/file.vsix`, sha256: `${API}/d/r/file.sha256` }
  })
}

describe('Open VSX client', () => {
  afterEach(() => setMainHttpClient(null))

  it('searches the Themes category', async () => {
    const fetch = useResponses({
      [`${API}/-/search?query=hub+contrast&category=Themes&size=24&sortBy=downloadCount&sortOrder=desc`]:
        Response.json({
          extensions: [
            { namespace: 'daylerees', name: 'rainglow', version: '1.5.2', displayName: 'Rainglow' }
          ]
        })
    })
    expect(await searchOpenVsxThemes('hub contrast')).toEqual([
      {
        namespace: 'daylerees',
        name: 'rainglow',
        version: '1.5.2',
        displayName: 'Rainglow',
        description: '',
        iconUrl: null
      }
    ])
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('downloads the .vsix and checks its sha256', async () => {
    useResponses({
      [`${API}/daylerees/rainglow`]: meta(),
      [`${API}/d/r/file.vsix`]: new Response(VSIX),
      [`${API}/d/r/file.sha256`]: new Response(`${SHA}\n`)
    })
    const result = await downloadOpenVsxExtension('daylerees', 'rainglow')
    expect(result.version).toBe('1.5.2')
    expect(result.bytes.equals(VSIX)).toBe(true)
  })

  it('refuses a download whose checksum does not match', async () => {
    useResponses({
      [`${API}/daylerees/rainglow`]: meta(),
      [`${API}/d/r/file.vsix`]: new Response(VSIX),
      [`${API}/d/r/file.sha256`]: new Response('0'.repeat(64))
    })
    await expect(downloadOpenVsxExtension('daylerees', 'rainglow')).rejects.toThrow(/Checksum/)
  })

  it('rejects ids that are not plain names', async () => {
    useResponses({})
    await expect(downloadOpenVsxExtension('../x', 'y')).rejects.toThrow(/Invalid/)
  })
})
