// Custom build (hq-plus-context): what the card reads from HQ's folder — a missing file is no text,
// not an error, so a project without a page or a plan still gets a card — and the project's people.
import { readFile, stat } from 'node:fs/promises'
import { hqPeopleOfProject, hqPersonChannelLine } from '../../shared/hq-people'
import type { PulsePerson } from '../../shared/pulse-types'
import { buildHqPeopleRows, readHqPeopleFiles } from '../hq-today/hq-people'

export async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

export async function changedAt(path: string): Promise<number | null> {
  try {
    return (await stat(path)).mtimeMs
  } catch {
    return null
  }
}

/** Custom build (hq-closed-loop): the project's people, from the dossiers in HQ's `people/`. */
export async function hqContextPeople(
  root: string,
  project: string,
  pulsePeople: readonly PulsePerson[]
): Promise<{ name: string; role: string | null; write: string | null }[]> {
  const files = await readHqPeopleFiles(root).catch(() => null)
  return files
    ? hqPeopleOfProject(
        buildHqPeopleRows({ files, people: [...pulsePeople], waitings: [] }),
        project
      ).map(({ row, role }) => ({ name: row.name, role, write: hqPersonChannelLine(row.channel) }))
    : []
}
