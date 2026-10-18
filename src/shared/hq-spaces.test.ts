import { describe, expect, it } from 'vitest'
import {
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
          order: 1
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
      order: 100
    })
    expect(readHqSpaceFile('../etc', {})).toBeNull()
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
        projects: ['acme-flows', 'acme-api']
      },
      {
        slug: 'personal',
        name: 'Личное',
        color: '#737373',
        repoIds: ['r-orca'],
        projects: ['orca-custom']
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
