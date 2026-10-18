import { describe, expect, it } from 'vitest'
import type { HqSpace } from '../../shared/hq-spaces'
import { applyHqSpaceGitAuthors } from './hq-space-git-authors'

const LH: HqSpace = {
  slug: 'acme',
  name: 'Acme',
  color: '#3b82f6',
  repoIds: ['r-api', 'r-fb', 'r-remote'],
  projects: ['acme-api', 'acme-flows'],
  git: { name: 'Alex Owner', email: 'owner@acme.example' }
}
const PERSONAL: HqSpace = {
  slug: 'personal',
  name: 'Личное',
  color: '#22c55e',
  repoIds: ['r-orca'],
  projects: ['orca-custom'],
  git: null
}

describe('applyHqSpaceGitAuthors', () => {
  it('sets the workspace author only where the repo’s own config differs, local repos only', async () => {
    const config = new Map<string, string>([
      ['/fb user.name', 'Alex Owner'],
      ['/fb user.email', 'owner@acme.example'],
      ['/orca user.email', 'noreply@github.com']
    ])
    const writes: string[] = []
    const changes = await applyHqSpaceGitAuthors({
      spaces: async () => [LH, PERSONAL],
      repos: () => [
        { id: 'r-api', path: '/api', local: true },
        { id: 'r-fb', path: '/fb', local: true },
        { id: 'r-remote', path: '/remote', local: false },
        { id: 'r-orca', path: '/orca', local: true }
      ],
      readLocal: async (path, key) => config.get(`${path} ${key}`) ?? null,
      writeLocal: async (path, key, value) => {
        writes.push(`${path} ${key}=${value}`)
      }
    })
    expect(writes).toEqual(['/api user.name=Alex Owner', '/api user.email=owner@acme.example'])
    expect(changes).toEqual([
      { path: '/api', space: 'acme', from: null, to: 'owner@acme.example' }
    ])
  })
})
