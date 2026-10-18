import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { listHqSpaces } from './hq-spaces'

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
        projects: ['acme-api']
      }
    ])
  })

  it('is empty without a workspaces folder', async () => {
    hq = await mkdtemp(join(tmpdir(), 'hq-spaces-'))
    expect(await listHqSpaces(hq)).toEqual([])
  })
})
