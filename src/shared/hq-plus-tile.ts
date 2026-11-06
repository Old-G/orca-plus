// Custom build (hq-plus-work-view, owner 06.11): a project's tile letters come from the part of its name
// that tells it apart. Projects of one family share their first word (`acme-agents`, `acme_ai_brain`),
// so «first letters of the first two words» gave every one of them the same tile; the family's word and
// generic ones (mcp, server, ai) are skipped at the front: acme-agents → AG, acme_ai_brain → BR,
// acme-mcp-server-api → API. The family is read off the projects themselves, not written in.

const GENERIC_PREFIXES: ReadonlySet<string> = new Set(['mcp', 'server', 'ai'])
const NO_FAMILIES: ReadonlySet<string> = new Set()

function wordsOf(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
}

/** First words that two or more of the projects open with — a family prefix, skipped on the tile. */
export function hqPlusTileFamilies(names: Iterable<string>): ReadonlySet<string> {
  const counts = new Map<string, number>()
  const seen = new Set<string>()
  for (const name of names) {
    const words = wordsOf(name)
    const key = words.join('-')
    // Why: the same project under its slug and its repo name counts once.
    if (words.length < 2 || seen.has(key)) {
      continue
    }
    seen.add(key)
    counts.set(words[0], (counts.get(words[0]) ?? 0) + 1)
  }
  return new Set([...counts].filter(([, count]) => count >= 2).map(([word]) => word))
}

/** Two letters for the project's tile (a short last word whole); «HQ» for none. */
export function hqPlusTileOf(
  project: string | null,
  families: ReadonlySet<string> = NO_FAMILIES
): string {
  if (!project) {
    return 'HQ'
  }
  const words = wordsOf(project)
  if (words.length === 0) {
    return project.slice(0, 2).toUpperCase()
  }
  let start = 0
  while (
    start < words.length - 1 &&
    (families.has(words[start]) || GENERIC_PREFIXES.has(words[start]))
  ) {
    start += 1
  }
  const rest = words.slice(start)
  if (rest.length > 1) {
    return `${[...rest[0]][0]}${[...rest[1]][0]}`.toUpperCase()
  }
  const word = rest[0]
  return ([...word].length <= 3 ? word : [...word].slice(0, 2).join('')).toUpperCase()
}
