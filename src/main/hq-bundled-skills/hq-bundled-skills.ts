// Custom build (hq-bundled-skills): Orca+ ships the HQ skills (ask-hq, ask-person, daily-review…) and
// keeps the copies it placed in the user's Claude skills folder current. A folder it did not place is
// the owner's: if any bundled name is taken by one, the owner manages the set by hand and nothing is
// touched. Every write goes through a temp folder and a rename, so a skill is never half-copied.
import { createHash } from 'node:crypto'
import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'

export const HQ_SKILL_MARKER = '.orca-plus-skill.json'

export type HqSkillsSyncResult = {
  installed: string[]
  updated: string[]
  removed: string[]
  unchanged: string[]
  /** A bundled name is taken by a folder Orca+ did not place; nothing was written. */
  handManagedBy: string | null
}

type Marker = { source: 'orca-plus'; skill: string; digest: string }

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false
  )
}

async function filesUnder(root: string): Promise<string[]> {
  const out: string[] = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== '__pycache__') {
        out.push(...(await filesUnder(path)))
      }
    } else if (entry.isFile() && entry.name !== HQ_SKILL_MARKER && !entry.name.endsWith('.pyc')) {
      out.push(path)
    }
  }
  return out
}

/** Content hash of a skill folder: relative paths, bytes and the executable bit, in a fixed order. */
export async function skillDigest(dir: string): Promise<string> {
  const hash = createHash('sha256')
  const files = (await filesUnder(dir)).sort()
  for (const file of files) {
    const mode = (await stat(file)).mode & 0o111 ? 'x' : '-'
    hash.update(`${relative(dir, file)}\0${mode}\0`)
    hash.update(await readFile(file))
    hash.update('\0')
  }
  return hash.digest('hex')
}

async function readMarker(dir: string): Promise<Marker | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(join(dir, HQ_SKILL_MARKER), 'utf8'))
    if (
      parsed &&
      typeof parsed === 'object' &&
      Reflect.get(parsed, 'source') === 'orca-plus' &&
      typeof Reflect.get(parsed, 'digest') === 'string'
    ) {
      return {
        source: 'orca-plus',
        skill: String(Reflect.get(parsed, 'skill')),
        digest: String(Reflect.get(parsed, 'digest'))
      }
    }
  } catch {
    // No marker or an unreadable one: the folder is not ours.
  }
  return null
}

async function bundledSkills(sourceRoot: string): Promise<string[]> {
  const names: string[] = []
  for (const entry of await readdir(sourceRoot, { withFileTypes: true })) {
    if (entry.isDirectory() && (await exists(join(sourceRoot, entry.name, 'SKILL.md')))) {
      names.push(entry.name)
    }
  }
  return names.sort()
}

async function place(source: string, target: string, marker: Marker): Promise<void> {
  const temp = `${target}.orca-plus-tmp-${process.pid}`
  await rm(temp, { recursive: true, force: true })
  await cp(source, temp, {
    recursive: true,
    filter: (path) => !path.includes('__pycache__') && !path.endsWith('.pyc')
  })
  await writeFile(join(temp, HQ_SKILL_MARKER), `${JSON.stringify(marker, null, 2)}\n`)
  await rm(target, { recursive: true, force: true })
  await rename(temp, target)
}

/** Brings `targetRoot/<skill>` in line with every skill under `sourceRoot`. */
export async function syncBundledHqSkills(
  sourceRoot: string,
  targetRoot: string
): Promise<HqSkillsSyncResult> {
  const result: HqSkillsSyncResult = {
    installed: [],
    updated: [],
    removed: [],
    unchanged: [],
    handManagedBy: null
  }
  const names = await bundledSkills(sourceRoot)
  const markers = new Map<string, Marker | null>()
  for (const name of names) {
    const target = join(targetRoot, name)
    if (await exists(target)) {
      const marker = await readMarker(target)
      if (!marker) {
        result.handManagedBy = name
        return result
      }
      markers.set(name, marker)
    }
  }
  await mkdir(targetRoot, { recursive: true })
  for (const name of names) {
    const digest = await skillDigest(join(sourceRoot, name))
    const current = markers.get(name)
    if (current?.digest === digest) {
      result.unchanged.push(name)
      continue
    }
    await place(join(sourceRoot, name), join(targetRoot, name), {
      source: 'orca-plus',
      skill: name,
      digest
    })
    if (current) {
      result.updated.push(name)
    } else {
      result.installed.push(name)
    }
  }
  // Why: a skill dropped from the bundle would otherwise linger with stale instructions.
  for (const entry of await readdir(targetRoot, { withFileTypes: true })) {
    if (entry.isDirectory() && !names.includes(entry.name)) {
      const marker = await readMarker(join(targetRoot, entry.name))
      if (marker) {
        await rm(join(targetRoot, entry.name), { recursive: true, force: true })
        result.removed.push(entry.name)
      }
    }
  }
  return result
}

/** The pointer the skills' scripts read when they are not started inside the HQ folder. */
export async function writeHqPathPointer(
  pointerPath: string,
  hqPath: string | null
): Promise<void> {
  await mkdir(dirname(pointerPath), { recursive: true })
  const temp = `${pointerPath}.${process.pid}.tmp`
  await writeFile(temp, `${JSON.stringify({ hqPath }, null, 2)}\n`)
  await rename(temp, pointerPath)
}
