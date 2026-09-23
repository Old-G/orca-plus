import { posix } from 'node:path'

// Custom build (orca-plus-packaging): an orcad built from this fork serves its browser from an
// installed Orca+ first, so it never borrows a stock Orca of another version.
// Why no import.meta.env here: orcad is bundled by esbuild, which does not define it.
export function orcaPlusMacExecutableCandidates(homePath: string): string[] {
  return [
    '/Applications/Orca Plus.app/Contents/MacOS/Orca Plus',
    posix.join(homePath, 'Applications', 'Orca Plus.app', 'Contents', 'MacOS', 'Orca Plus')
  ]
}
