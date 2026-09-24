import { createHash } from 'node:crypto'
import { getMainHttpClient } from '../network/http-client'

// Custom build (vscode-theme-import): Open VSX, the extension registry Cursor uses.

const API = 'https://open-vsx.org/api'
const MAX_VSIX_BYTES = 64 * 1024 * 1024

export type OpenVsxThemeResult = {
  namespace: string
  name: string
  version: string
  displayName: string
  description: string
  iconUrl: string | null
}

export class OpenVsxError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

async function getJson(url: string): Promise<unknown> {
  const response = await getMainHttpClient().fetch(url, { headers: { accept: 'application/json' } })
  if (!response.ok) {
    await response.body?.cancel()
    throw new OpenVsxError(`Open VSX answered ${response.status}`)
  }
  return response.json()
}

export async function searchOpenVsxThemes(query: string): Promise<OpenVsxThemeResult[]> {
  // Why download count: relevance ranks near-empty forks above the official themes people look for.
  const params = new URLSearchParams({
    query,
    category: 'Themes',
    size: '24',
    sortBy: 'downloadCount',
    sortOrder: 'desc'
  })
  const json = await getJson(`${API}/-/search?${params.toString()}`)
  const extensions = isRecord(json) && Array.isArray(json.extensions) ? json.extensions : []
  return extensions.filter(isRecord).map((entry) => ({
    namespace: text(entry.namespace),
    name: text(entry.name),
    version: text(entry.version),
    displayName: text(entry.displayName) || text(entry.name),
    description: text(entry.description),
    iconUrl: isRecord(entry.files) && text(entry.files.icon) ? text(entry.files.icon) : null
  }))
}

/** Downloads the latest .vsix and checks it against the registry's sha256. */
export async function downloadOpenVsxExtension(
  namespace: string,
  name: string
): Promise<{ bytes: Buffer; version: string }> {
  const segment = (value: string): string => {
    if (!/^[\w.-]+$/.test(value)) {
      throw new OpenVsxError('Invalid extension id')
    }
    return encodeURIComponent(value)
  }
  const meta = await getJson(`${API}/${segment(namespace)}/${segment(name)}`)
  const files = isRecord(meta) && isRecord(meta.files) ? meta.files : {}
  const downloadUrl = text(files.download)
  if (!downloadUrl.startsWith('https://')) {
    throw new OpenVsxError('No download for this extension')
  }
  const response = await getMainHttpClient().fetch(downloadUrl)
  if (!response.ok) {
    await response.body?.cancel()
    throw new OpenVsxError(`Download failed (${response.status})`)
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length > MAX_VSIX_BYTES) {
    throw new OpenVsxError('Extension is too large')
  }
  const shaUrl = text(files.sha256)
  if (shaUrl.startsWith('https://')) {
    const shaResponse = await getMainHttpClient().fetch(shaUrl)
    if (!shaResponse.ok) {
      await shaResponse.body?.cancel()
    }
    const expected = shaResponse.ok ? (await shaResponse.text()).trim().split(/\s+/)[0] : ''
    const actual = createHash('sha256').update(bytes).digest('hex')
    if (expected && expected.toLowerCase() !== actual) {
      throw new OpenVsxError('Checksum mismatch')
    }
  }
  return { bytes, version: isRecord(meta) ? text(meta.version) : '' }
}
