// Custom build (hq-autonomy): how far an agent may go in a project without the owner — HQ's
// autonomy.yaml, which the owner edits by hand. Production is never touched without a «да».
export const HQ_AUTONOMY_LEVELS = [0, 1, 2, 3] as const

export type HqAutonomyLevel = (typeof HQ_AUTONOMY_LEVELS)[number]

export const HQ_AUTONOMY_FILE = 'autonomy.yaml'

/** Used when the file or its `default` is missing. */
export const HQ_AUTONOMY_FALLBACK: HqAutonomyLevel = 1

export type HqAutonomyConfig = {
  defaultLevel: HqAutonomyLevel
  /** By HQ project slug. */
  projects: Record<string, HqAutonomyLevel>
}

function readLevel(value: string): HqAutonomyLevel | null {
  return HQ_AUTONOMY_LEVELS.find((level) => String(level) === value.trim()) ?? null
}

/**
 * The subset of YAML the file uses: `default: N` and a `projects:` map of `slug: N`. Read by line so a
 * typo spoils only its own line; an unknown level keeps the default rather than granting more.
 */
export function parseHqAutonomy(text: string | null): HqAutonomyConfig {
  const config: HqAutonomyConfig = { defaultLevel: HQ_AUTONOMY_FALLBACK, projects: {} }
  let inProjects = false
  for (const raw of (text ?? '').split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '').replace(/^#.*$/, '')
    if (!line.trim()) {
      continue
    }
    const top = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line)
    if (top) {
      inProjects = top[1] === 'projects' && top[2] === ''
      const level = top[1] === 'default' ? readLevel(top[2]) : null
      if (level !== null) {
        config.defaultLevel = level
      }
      continue
    }
    const entry = inProjects ? /^\s+["']?([^"':\s]+)["']?:\s*(\S+)\s*$/.exec(line) : null
    const level = entry ? readLevel(entry[2]) : null
    if (entry && level !== null) {
      config.projects[entry[1]] = level
    }
  }
  return config
}

export function hqAutonomyFor(config: HqAutonomyConfig, slug: string): HqAutonomyLevel {
  return config.projects[slug] ?? config.defaultLevel
}
