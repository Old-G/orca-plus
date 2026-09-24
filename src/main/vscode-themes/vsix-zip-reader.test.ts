import { describe, expect, it } from 'vitest'
import { buildTestZip } from './vsix-test-archive'
import { openVsixArchive, VsixFormatError } from './vsix-zip-reader'

describe('openVsixArchive', () => {
  it('reads deflated and stored entries', () => {
    for (const deflate of [true, false]) {
      const archive = openVsixArchive(
        buildTestZip({ 'extension/package.json': '{"name":"x"}', 'extension/a.json': 'é' }, deflate)
      )
      expect(archive.names()).toEqual(['extension/package.json', 'extension/a.json'])
      expect(archive.readText('extension/package.json')).toBe('{"name":"x"}')
      expect(archive.readText('extension/a.json')).toBe('é')
      expect(archive.readText('extension/missing.json')).toBeNull()
    }
  })

  it('rejects data that is not a zip', () => {
    expect(() => openVsixArchive(Buffer.from('not a zip at all, just text'.repeat(3)))).toThrow(
      VsixFormatError
    )
  })

  it('rejects a corrupt central directory', () => {
    const zip = buildTestZip({ 'extension/package.json': '{}' })
    const centralOffset = zip.readUInt32LE(zip.length - 6)
    zip.writeUInt32LE(0, centralOffset)
    expect(() => openVsixArchive(zip)).toThrow(VsixFormatError)
  })
})
