import { describe, expect, it } from 'vitest'
import {
  hqSpaceWrongChannel,
  hqReviewProject,
  hqSpaceUsesSource,
  hqSpaceOf,
  hqSpaceShows,
  readHqSpaceFile,
  resolveHqSpaces,
  type HqSpaceFile
} from './hq-spaces'

function file(slug: string, data: unknown): HqSpaceFile {
  const read = readHqSpaceFile(slug, data)
  if (!read) {
    throw new Error(`no space file for ${slug}`)
  }
  return read
}

const PROJECTS = [
  { repoId: 'r-api', slug: 'acme-api', group: 'Acme Projects' },
  { repoId: 'r-fb', slug: 'acme-flows', group: 'Acme In Process' },
  { repoId: 'r-hobby-app', slug: 'hobby-app', group: null },
  { repoId: 'r-orca', slug: 'orca-custom', group: null }
]

function spaces() {
  return resolveHqSpaces(
    [
      {
        slug: 'personal',
        file: file('personal', { name: 'Личное', projects: ['orca-custom'], order: 3 })
      },
      {
        slug: 'acme',
        file: file('acme', {
          name: 'Acme',
          color: '#3b82f6',
          groups: ['Acme Projects', 'Acme In Process'],
          order: 1,
          messenger: 'Slack',
          tasks: 'clickup',
          git: { name: ' Alex Owner ', email: 'owner@acme.example' }
        })
      }
    ],
    PROJECTS
  )
}

describe('readHqSpaceFile', () => {
  it('falls back field by field and refuses a bad folder name', () => {
    expect(readHqSpaceFile('og-news', { color: 'blue', groups: 'x' })).toEqual({
      name: 'og-news',
      color: '#737373',
      groups: [],
      projects: [],
      order: 100,
      messenger: null,
      tasks: null,
      git: null
    })
    expect(readHqSpaceFile('../etc', {})).toBeNull()
  })
})

describe('the git author in workspace.yaml', () => {
  it('drops one that would not make a sane git identity', () => {
    expect(file('x', { git: { name: 'A\nB', email: 'a@b.c' } }).git).toBeNull()
    expect(file('x', { git: { name: 'A', email: 'not an email' } }).git).toBeNull()
  })
})

describe('resolveHqSpaces', () => {
  it('gives each space its groups’ and listed projects, in order', () => {
    expect(spaces()).toEqual([
      {
        slug: 'acme',
        name: 'Acme',
        color: '#3b82f6',
        repoIds: ['r-api', 'r-fb'],
        projects: ['acme-flows', 'acme-api'],
        messenger: 'slack',
        tasks: 'clickup',
        git: { name: 'Alex Owner', email: 'owner@acme.example' }
      },
      {
        slug: 'personal',
        name: 'Личное',
        color: '#737373',
        repoIds: ['r-orca'],
        projects: ['orca-custom'],
        messenger: null,
        tasks: null,
        git: null
      }
    ])
  })
})

describe('hqSpaceShows', () => {
  it('shows a space’s own records, and records no space claims, everywhere', () => {
    const all = spaces()
    expect(hqSpaceShows(all, 'acme', { repoId: 'r-fb' })).toBe(true)
    expect(hqSpaceShows(all, 'acme', { project: 'orca-custom' })).toBe(false)
    expect(hqSpaceShows(all, 'acme', { project: 'hobby-app' })).toBe(true)
    expect(hqSpaceShows(all, 'acme', {})).toBe(true)
    expect(hqSpaceShows(all, null, { project: 'orca-custom' })).toBe(true)
    expect(hqSpaceShows(all, 'gone', { project: 'orca-custom' })).toBe(true)
  })

  it('matches a project named by its folder', () => {
    expect(hqSpaceOf(spaces(), { project: 'Billing' })?.slug).toBe('acme')
  })
})

describe('hqSpaceUsesSource', () => {
  it('keeps Slack and ClickUp without a project only where the workspace uses them', () => {
    const all = spaces()
    expect(hqSpaceUsesSource(all, 'acme', 'clickup')).toBe(true)
    expect(hqSpaceUsesSource(all, 'personal', 'slack')).toBe(false)
    expect(hqSpaceUsesSource(all, null, 'slack')).toBe(true)
  })
})

describe('hqReviewProject', () => {
  it('reads the repo name from a review ref', () => {
    expect(hqReviewProject('acme/backend/acme-api!34')).toBe('acme-api')
    expect(hqReviewProject('owner/repo#12')).toBe('repo')
    expect(hqReviewProject('nonsense')).toBeNull()
  })
})

describe('hqSpaceWrongChannel', () => {
  it('names the workspace a message leaves through a messenger it does not use', () => {
    const all = spaces()
    expect(hqSpaceWrongChannel(all, 'orca-custom', 'slack')?.slug).toBe('personal')
    expect(hqSpaceWrongChannel(all, 'acme-api', 'slack')).toBeNull()
    expect(hqSpaceWrongChannel(all, 'acme-api', 'clickup')).toBeNull()
    expect(hqSpaceWrongChannel(all, 'strata', 'slack')).toBeNull()
    expect(hqSpaceWrongChannel(all, null, 'slack')).toBeNull()
  })
})
