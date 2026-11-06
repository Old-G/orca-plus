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

/** Custom build (remote-own-work, plan 15.17): the agent's own deploys and cleanups on a server that
 *  need no Approve card — HQ autonomy.yaml's `remote_no_approve` block. Empty lists pass nothing. */
export type HqRemoteNoApprove = {
  /** ssh hosts; a command that reaches any other host keeps its card. */
  hosts: string[]
  /** Containers `docker rm -f` may remove; `*` stands for any part of a name. */
  containers: string[]
  /** Paths `rm -r`/`rm -f` may remove, on the server or inside a container; a trailing `*` is a prefix. */
  rmPaths: string[]
  /** `container:/path` files `rm -f` may remove inside that container; `*` stands for part of the
   *  file's name (owner 06.11: the agent's probe scripts it copies in and removes after the run). */
  containerRmPaths: string[]
  /** `rm` of a variable the same command set from `mktemp` passes. */
  mktemp: boolean
}

const REMOTE_LIST_KEYS = {
  hosts: 'hosts',
  containers: 'containers',
  rm_paths: 'rmPaths',
  container_rm_paths: 'containerRmPaths'
} as const

/** `key: a, b` or `key: [a, b]` → its items, quotes stripped. */
function readList(value: string): string[] {
  return value
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((item) => item.trim().replace(/^(["'])(.*)\1$/, '$2'))
    .filter(Boolean)
}

/**
 * The `remote_no_approve:` block: `hosts`, `containers`, `rm_paths` and `container_rm_paths` as
 * comma-separated lists (plain YAML strings, so `*-check` stays valid YAML) and `mktemp: yes`. Unknown
 * keys are ignored.
 */
export function parseHqRemoteNoApprove(text: string | null): HqRemoteNoApprove {
  const config: HqRemoteNoApprove = {
    hosts: [],
    containers: [],
    rmPaths: [],
    containerRmPaths: [],
    mktemp: false
  }
  let inBlock = false
  for (const raw of (text ?? '').split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '').replace(/^\s*#.*$/, '')
    if (!line.trim()) {
      continue
    }
    const top = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line)
    if (top) {
      inBlock = top[1] === 'remote_no_approve' && top[2] === ''
      continue
    }
    const entry = inBlock ? /^\s+([a-z_]+):\s*(.*?)\s*$/.exec(line) : null
    if (!entry) {
      continue
    }
    if (entry[1] === 'mktemp') {
      config.mktemp = /^(?:yes|true|on)$/i.test(entry[2])
    } else if (entry[1] in REMOTE_LIST_KEYS) {
      config[REMOTE_LIST_KEYS[entry[1] as keyof typeof REMOTE_LIST_KEYS]] = readList(entry[2])
    }
  }
  return config
}
