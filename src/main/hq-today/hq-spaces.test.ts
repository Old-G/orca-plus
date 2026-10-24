import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { hqSpaceOf } from '../../shared/hq-spaces'
import { listHqSpaces, readHqSpacePlacing, setHqSpaceLiveGroups } from './hq-spaces'

let hq: string | null = null

afterEach(async () => {
  if (hq) {
    await rm(hq, { recursive: true, force: true })
  }
})

describe('listHqSpaces', () => {
  it('reads each workspace folder against the project pages; a folder without yaml is skipped', async () => {
    hq = await mkdtemp(join(tmpdir(), 'hq-spaces-'))
    await mkdir(join(hq, 'projects'))
    await writeFile(
      join(hq, 'projects', 'acme-api.md'),
      '---\nid: r-api\nproject: acme-api\ngroup: Acme Projects\n---\n# acme-api\n'
    )
    await mkdir(join(hq, 'workspaces', 'acme'), { recursive: true })
    await writeFile(
      join(hq, 'workspaces', 'acme', 'workspace.yaml'),
      'name: Acme\ncolor: "#3b82f6"\ngroups:\n  - Acme Projects\n'
    )
    await mkdir(join(hq, 'workspaces', 'empty'))
    expect(await listHqSpaces(hq)).toEqual([
      {
        slug: 'acme',
        name: 'Acme',
        color: '#3b82f6',
        repoIds: ['r-api'],
        projects: ['acme-api'],
        messenger: null,
        tasks: null,
        git: null,
        groupId: null
      }
    ])
  })

  it('places a project by its live sidebar group, not by its page of the last sync', async () => {
    hq = await mkdtemp(join(tmpdir(), 'hq-spaces-'))
    await mkdir(join(hq, 'projects'))
    await writeFile(
      join(hq, 'projects', 'odoo.md'),
      '---\nid: r-odoo\nproject: odoo\ngroup: null\n---\n# odoo\n'
    )
    await mkdir(join(hq, 'workspaces', 'acme'), { recursive: true })
    await writeFile(
      join(hq, 'workspaces', 'acme', 'workspace.yaml'),
      'name: Acme\ngroup_id: g-acme\n'
    )
    setHqSpaceLiveGroups(() => ({
      repos: [{ id: 'r-odoo', projectGroupId: 'g-acme' }],
      groups: [{ id: 'g-acme', name: 'Acme', color: null, parentGroupId: null }]
    }))
    try {
      expect((await listHqSpaces(hq))[0]?.projects).toEqual(['odoo'])
    } finally {
      setHqSpaceLiveGroups(null)
    }
  })

  it('places a live repo HQ has no page for yet by its group, else in the default room', async () => {
    const hqRoot = await mkdtemp(join(tmpdir(), 'hq-spaces-'))
    hq = hqRoot
    await mkdir(join(hq, 'projects'))
    await mkdir(join(hq, 'workspaces', 'acme'), { recursive: true })
    await writeFile(
      join(hq, 'workspaces', 'acme', 'workspace.yaml'),
      'name: Acme\ngroup_id: g-acme\n'
    )
    await mkdir(join(hq, 'workspaces', 'personal'), { recursive: true })
    await writeFile(
      join(hq, 'workspaces', 'personal', 'workspace.yaml'),
      'name: Personal\ndefault: true\n'
    )
    setHqSpaceLiveGroups(() => ({
      repos: [
        { id: 'r-new', projectGroupId: 'g-acme' },
        { id: 'r-loose' },
        { id: 'r-hq', path: hqRoot }
      ],
      groups: [{ id: 'g-acme', name: 'Acme', color: null, parentGroupId: null }]
    }))
    try {
      const placing = await readHqSpacePlacing(hq)
      expect(placing.spaces.map((space) => [space.slug, space.repoIds, space.projects])).toEqual([
        ['acme', ['r-new'], []],
        ['personal', ['r-loose'], []]
      ])
      expect(hqSpaceOf(placing.spaces, { repoId: 'r-new' })?.slug).toBe('acme')
    } finally {
      setHqSpaceLiveGroups(null)
    }
  })

  it('is empty without a workspaces folder', async () => {
    hq = await mkdtemp(join(tmpdir(), 'hq-spaces-'))
    expect(await listHqSpaces(hq)).toEqual([])
  })
})
