import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PulseDb } from '../orca-plus/pulse/pulse-db'
import { createHqPulseMirror, type HqPulseMirrorDeps } from './hq-pulse-mirror'

// Made-up people and decisions; the HQ is a throwaway folder.
const dirs: string[] = []
const dbs: PulseDb[] = []

function setup(options: { dirty?: boolean; hq?: string | null; db?: PulseDb | null } = {}) {
  const hq = mkdtempSync(join(tmpdir(), 'orca-hq-pulse-'))
  dirs.push(hq)
  mkdirSync(join(hq, 'projects'))
  writeFileSync(join(hq, 'projects', 'app-a.md'), '# app-a\n')
  let tick = Date.parse('2026-09-28T09:00:00')
  let id = 0
  const db =
    options.db === undefined
      ? new PulseDb(':memory:', { now: () => (tick += 60_000), newId: () => `id-${++id}` })
      : options.db
  if (db) {
    dbs.push(db)
  }
  const git: string[][] = []
  const deps: HqPulseMirrorDeps = {
    hqPath: () => (options.hq === undefined ? hq : options.hq),
    openDb: () => db,
    git: async (args) => {
      git.push([...args])
      return {
        code: 0,
        stdout: args[0] === 'status' && options.dirty ? ' M x.md\n' : '',
        stderr: ''
      }
    },
    log: () => {},
    debounceMs: 5
  }
  return { hq, db: db!, git, mirror: createHqPulseMirror(deps) }
}

const read = (hq: string, rel: string): string => readFileSync(join(hq, rel), 'utf8')

afterEach(() => {
  for (const db of dbs.splice(0)) {
    db.close()
  }
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('HQ pulse mirror', () => {
  it('writes a decision page and its person page, marks it, and commits only those files', async () => {
    const { hq, db, git, mirror } = setup()
    const ann = db.upsertPerson({ name: 'Ann', role: 'PM', slackUserId: 'U1' })
    db.logDecision({
      title: 'Ship on Monday',
      body: 'After QA.',
      project: 'app-a',
      personId: ann.id,
      source: 'agent'
    })
    expect(await mirror.runNow()).toBe('committed')

    const [decision] = db.listDecisions()
    expect(decision?.mirroredPath).toBe('decisions/2026-09-28-ship-on-monday.md')
    const page = read(hq, 'decisions/2026-09-28-ship-on-monday.md')
    expect(page).toContain('# Ship on Monday')
    expect(page).toContain('After QA.')
    expect(page).toContain('- **Project:** [app-a](../projects/app-a.md)')
    expect(page).toContain('- **With:** [Ann](../people/ann.md)')
    const person = read(hq, 'people/ann.md')
    expect(person).toContain('- **Role:** PM')
    expect(person).toContain(
      '[2026-09-28 Ship on Monday](../decisions/2026-09-28-ship-on-monday.md)'
    )
    expect(git.at(-2)).toEqual([
      'add',
      '--',
      'decisions/2026-09-28-ship-on-monday.md',
      'people/ann.md'
    ])
    expect(git.at(-1)?.slice(0, 3)).toEqual(['commit', '-q', '-m'])

    git.length = 0
    expect(await mirror.runNow()).toBe('unchanged')
    expect(git.map((args) => args[0])).toEqual(['status'])
  })

  it('leaves approvals of drafts out of HQ', async () => {
    const { hq, db, mirror } = setup()
    const draft = db.addDraft({ kind: 'message', body: 'hi', source: 'agent' }).record
    db.decideDraft(draft.id, 'approved')
    expect(await mirror.runNow()).toBe('unchanged')
    expect(readdirSync(join(hq, 'decisions'))).toEqual([])
  })

  it('updates only the marked block of a person page and keeps the owner notes', async () => {
    const { hq, db, mirror } = setup()
    const ann = db.upsertPerson({ name: 'Ann', role: 'PM' })
    await mirror.runNow()
    writeFileSync(join(hq, 'people/ann.md'), `${read(hq, 'people/ann.md')}Prefers mornings.\n`)
    db.upsertPerson({ id: ann.id, name: 'Ann', role: 'Head of product' })
    expect(await mirror.runNow()).toBe('committed')
    const page = read(hq, 'people/ann.md')
    expect(page).toContain('- **Role:** Head of product')
    expect(page).toContain('Prefers mornings.')
  })

  it('leaves a person page alone once the owner removed the markers', async () => {
    const { hq, db, mirror } = setup()
    const ann = db.upsertPerson({ name: 'Ann' })
    await mirror.runNow()
    writeFileSync(
      join(hq, 'people/ann.md'),
      `---\npulse_person_id: "${ann.id}"\n---\n# Ann, by hand\n`
    )
    db.upsertPerson({ id: ann.id, name: 'Ann', role: 'PM' })
    expect(await mirror.runNow()).toBe('unchanged')
    expect(read(hq, 'people/ann.md')).toContain('# Ann, by hand')
  })

  it('keeps a renamed person on their page and gives a namesake another one', async () => {
    const { hq, db, mirror } = setup()
    const ann = db.upsertPerson({ name: 'Ann' })
    await mirror.runNow()
    db.upsertPerson({ id: ann.id, name: 'Ann Lee' })
    const other = db.upsertPerson({ name: 'Ann' })
    await mirror.runNow()
    expect(readdirSync(join(hq, 'people')).sort()).toEqual([
      `ann-${other.id.slice(0, 8)}.md`,
      'ann.md'
    ])
  })

  it('names a Russian decision readably and never overwrites an existing page', async () => {
    const { hq, db, mirror } = setup()
    db.logDecision({ title: 'Выкатываем в понедельник', source: 'agent' })
    db.logDecision({ title: 'Выкатываем в понедельник', source: 'agent' })
    await mirror.runNow()
    expect(readdirSync(join(hq, 'decisions')).sort()).toEqual([
      '2026-09-28-выкатываем-в-понедельник-2.md',
      '2026-09-28-выкатываем-в-понедельник.md'
    ])
  })

  it('adopts a page written before a crash instead of writing a second one', async () => {
    const { hq, db, mirror } = setup()
    const decision = db.logDecision({ title: 'Keep it', source: 'agent' })
    mkdirSync(join(hq, 'decisions'), { recursive: true })
    writeFileSync(
      join(hq, 'decisions/old-name.md'),
      `---\npulse_decision_id: "${decision.id}"\n---\n# Keep it\n`
    )
    await mirror.runNow()
    expect(readdirSync(join(hq, 'decisions'))).toEqual(['old-name.md'])
    expect(db.listDecisions()[0]?.mirroredPath).toBe('decisions/old-name.md')
  })

  it('writes but does not commit into an HQ with the owner’s changes', async () => {
    const { hq, db, git, mirror } = setup({ dirty: true })
    db.logDecision({ title: 'Pause', source: 'agent' })
    expect(await mirror.runNow()).toBe('left-uncommitted')
    expect(existsSync(join(hq, 'decisions/2026-09-28-pause.md'))).toBe(true)
    expect(git.some((args) => args[0] === 'commit')).toBe(false)
  })

  it('does nothing without an HQ folder or a pulse database', async () => {
    expect(await setup({ hq: null }).mirror.runNow()).toBe('off')
    expect(await setup({ hq: '/nonexistent/hq' }).mirror.runNow()).toBe('off')
    expect(await setup({ db: null }).mirror.runNow()).toBe('no-db')
  })
})
