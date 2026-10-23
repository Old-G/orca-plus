// Custom build (hq-plus-context): which file in HQ/plans/ is a project's plan — `<project>.md`, or a
// plan of another name whose frontmatter says `project: <slug>` (a plan can outlive a rename).
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { HQ_PLANS_DIR } from '../../shared/hq-context'
import { readHqProjectPageFields } from '../hq-project-pages/hq-project-pages'

export type HqPlanFile = { path: string; text: string; changedAt: number }

async function read(root: string, name: string): Promise<HqPlanFile | null> {
  const full = join(root, HQ_PLANS_DIR, name)
  try {
    const [text, info] = await Promise.all([readFile(full, 'utf8'), stat(full)])
    return { path: `${HQ_PLANS_DIR}/${name}`, text, changedAt: info.mtimeMs }
  } catch {
    return null
  }
}

export async function findHqPlanFile(hqPath: string, project: string): Promise<HqPlanFile | null> {
  const own = await read(hqPath, `${project}.md`)
  if (own) {
    return own
  }
  const names = (await readdir(join(hqPath, HQ_PLANS_DIR)).catch(() => [])).filter((name) =>
    name.endsWith('.md')
  )
  for (const name of names.sort()) {
    const file = await read(hqPath, name)
    if (file && readHqProjectPageFields(file.text).get('project') === project) {
      return file
    }
  }
  return null
}
