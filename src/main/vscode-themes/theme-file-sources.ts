import { readFile, stat } from 'node:fs/promises'
import { isAbsolute, join, posix } from 'node:path'
import type { ThemeFileSource } from './vscode-theme-loader'
import type { VsixArchive } from './vsix-zip-reader'

// Custom build (vscode-theme-import): theme files come from an extension folder or a .vsix;
// neither may be read outside the extension root, whatever a manifest says.

const MAX_FILE_BYTES = 16 * 1024 * 1024

function insideRoot(path: string): string | null {
  const normalized = posix.normalize(path)
  return normalized.startsWith('..') || isAbsolute(normalized) ? null : normalized
}

export function directoryThemeSource(root: string): ThemeFileSource {
  return {
    readText: async (path) => {
      const relative = insideRoot(path)
      if (!relative) {
        return null
      }
      const file = join(root, ...relative.split('/'))
      const info = await stat(file).catch(() => null)
      if (!info?.isFile() || info.size > MAX_FILE_BYTES) {
        return null
      }
      return readFile(file, 'utf8').catch(() => null)
    }
  }
}

/** A .vsix keeps the extension under `extension/`. */
export function vsixThemeSource(archive: VsixArchive): ThemeFileSource {
  return {
    readText: async (path) => {
      const relative = insideRoot(path)
      return relative ? archive.readText(`extension/${relative}`) : null
    }
  }
}
