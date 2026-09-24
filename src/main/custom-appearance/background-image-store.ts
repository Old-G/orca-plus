import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, readdir, readFile, rm, stat } from 'node:fs/promises'
import { extname, join } from 'node:path'
import {
  type BackgroundImageErrorCode,
  BACKGROUND_IMAGE_EXTENSIONS,
  BACKGROUND_IMAGE_MAX_BYTES,
  isBackgroundImageFileName
} from '../../shared/custom-appearance-background'

// Custom build (appearance-background): the picked image is copied into the profile, so moving
// or deleting the original never breaks the background.

const EXTENSIONS: ReadonlySet<string> = new Set(BACKGROUND_IMAGE_EXTENSIONS)

export class BackgroundImageError extends Error {
  constructor(readonly code: BackgroundImageErrorCode) {
    super(code)
  }
}

export async function importBackgroundImage(sourcePath: string, dir: string): Promise<string> {
  const ext = extname(sourcePath).slice(1).toLowerCase()
  if (!EXTENSIONS.has(ext)) {
    throw new BackgroundImageError('unsupported')
  }
  const info = await stat(sourcePath).catch(() => null)
  if (!info?.isFile()) {
    throw new BackgroundImageError('unreadable')
  }
  if (info.size > BACKGROUND_IMAGE_MAX_BYTES) {
    throw new BackgroundImageError('too-large')
  }
  await mkdir(dir, { recursive: true })
  const fileName = `background-${randomUUID()}.${ext}`
  await copyFile(sourcePath, join(dir, fileName))
  await removeBackgroundImages(dir, fileName)
  return fileName
}

export async function readBackgroundImage(dir: string, fileName: string): Promise<Buffer | null> {
  if (!isBackgroundImageFileName(fileName)) {
    return null
  }
  return readFile(join(dir, fileName)).catch(() => null)
}

/** Deletes every stored background except `keep`. */
export async function removeBackgroundImages(dir: string, keep?: string): Promise<void> {
  const names = await readdir(dir).catch(() => [])
  await Promise.all(
    names
      .filter((name) => isBackgroundImageFileName(name) && name !== keep)
      .map((name) => rm(join(dir, name), { force: true }))
  )
}
