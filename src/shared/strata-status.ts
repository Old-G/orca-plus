// Custom build (strata-status): how far a project has adopted Strata, read from its root files.

/** `unknown` means the host could not be asked (SSH down, remote runtime), never "absent". */
export type StrataStatus = 'full' | 'claude-md' | 'none' | 'unknown'

export type StrataAdoptResult = { ok: true; worktreeId: string } | { ok: false; error: string }

export const STRATA_ADOPT_PROMPT = '/strata:adopt'
export const STRATA_ADOPT_WORKTREE_NAME = 'strata-adopt'

/** Resolves true/false for a file under the project root, or null when that cannot be told. */
export type StrataFileProbe = (relativePath: string) => Promise<boolean | null>

// Same rule as the HQ sync: WIKI.md + wiki/index.md → full; CLAUDE.md alone → claude-md.
export async function classifyStrataStatus(fileExists: StrataFileProbe): Promise<StrataStatus> {
  const [wiki, wikiIndex, claudeMd] = await Promise.all([
    fileExists('WIKI.md'),
    fileExists('wiki/index.md'),
    fileExists('CLAUDE.md')
  ])
  if (wiki && wikiIndex) {
    return 'full'
  }
  if (claudeMd) {
    return 'claude-md'
  }
  return wiki === null || wikiIndex === null || claudeMd === null ? 'unknown' : 'none'
}

/** Only a project the host could read, and that is not fully on Strata yet, can be adopted. */
export function canAdoptStrata(status: StrataStatus | undefined): boolean {
  return status === 'none' || status === 'claude-md'
}
