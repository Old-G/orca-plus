import { inflateRawSync } from 'node:zlib'

// Custom build (vscode-theme-import): a .vsix is a zip. We only need to read a few small text
// entries (package.json, theme JSON), so a central-directory reader on zlib beats a dependency.

const END_OF_CENTRAL_DIRECTORY = 0x06054b50
const CENTRAL_DIRECTORY_ENTRY = 0x02014b50
const LOCAL_FILE_HEADER = 0x04034b50
const MAX_ENTRY_BYTES = 16 * 1024 * 1024
const MAX_ENTRIES = 20_000

export class VsixFormatError extends Error {}

type ZipEntry = { method: number; compressedSize: number; size: number; localHeaderOffset: number }

export type VsixArchive = {
  names: () => string[]
  readText: (name: string) => string | null
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  // Why the 64 KiB window: the record sits at the end, after an optional comment of up to 65535 bytes.
  const stop = Math.max(0, buffer.length - 22 - 0xffff)
  for (let offset = buffer.length - 22; offset >= stop; offset--) {
    if (buffer.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY) {
      return offset
    }
  }
  throw new VsixFormatError('Not a zip archive')
}

function readCentralDirectory(buffer: Buffer): Map<string, ZipEntry> {
  const end = findEndOfCentralDirectory(buffer)
  const count = buffer.readUInt16LE(end + 10)
  let offset = buffer.readUInt32LE(end + 16)
  if (count > MAX_ENTRIES) {
    throw new VsixFormatError('Too many entries')
  }
  const entries = new Map<string, ZipEntry>()
  for (let index = 0; index < count; index++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== CENTRAL_DIRECTORY_ENTRY) {
      throw new VsixFormatError('Corrupt central directory')
    }
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength)
    entries.set(name, {
      method: buffer.readUInt16LE(offset + 10),
      compressedSize: buffer.readUInt32LE(offset + 20),
      size: buffer.readUInt32LE(offset + 24),
      localHeaderOffset: buffer.readUInt32LE(offset + 42)
    })
    offset += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

function readEntry(buffer: Buffer, entry: ZipEntry): Buffer {
  if (entry.size > MAX_ENTRY_BYTES || entry.compressedSize > MAX_ENTRY_BYTES) {
    throw new VsixFormatError('Entry too large')
  }
  const header = entry.localHeaderOffset
  if (header + 30 > buffer.length || buffer.readUInt32LE(header) !== LOCAL_FILE_HEADER) {
    throw new VsixFormatError('Corrupt local header')
  }
  const start = header + 30 + buffer.readUInt16LE(header + 26) + buffer.readUInt16LE(header + 28)
  const data = buffer.subarray(start, start + entry.compressedSize)
  if (entry.method === 0) {
    return data
  }
  if (entry.method === 8) {
    return inflateRawSync(data, { maxOutputLength: MAX_ENTRY_BYTES })
  }
  throw new VsixFormatError(`Unsupported compression method ${entry.method}`)
}

export function openVsixArchive(buffer: Buffer): VsixArchive {
  const entries = readCentralDirectory(buffer)
  return {
    names: () => [...entries.keys()],
    readText: (name) => {
      const entry = entries.get(name)
      return entry ? readEntry(buffer, entry).toString('utf8') : null
    }
  }
}
