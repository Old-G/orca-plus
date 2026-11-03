import { describe, expect, it } from 'vitest'
import { hqWaitingProject } from './hq-waiting-project'

const SLUGS = ['acme-api', 'acme_shop', 'mcp-server-gitlab']

// Custom build (hq-waiting-project, owner 03.11): plan stage 20.6, scenario С10.
describe('hqWaitingProject', () => {
  it('keeps a named project as HQ spells it', () => {
    expect(hqWaitingProject('acme-shop', 'acme-api', SLUGS)).toBe('acme_shop')
    expect(hqWaitingProject(' ACME-API ', null, SLUGS)).toBe('acme-api')
  })

  it('С10: a note without a project, or with one HQ does not know, takes the writing chat’s', () => {
    expect(hqWaitingProject(null, 'acme-api', SLUGS)).toBe('acme-api')
    expect(hqWaitingProject('lh-mcp-server-gitlab', 'mcp_server_gitlab', SLUGS)).toBe(
      'mcp-server-gitlab'
    )
  })

  it('files nowhere rather than under a project HQ does not have', () => {
    expect(hqWaitingProject('nope', 'other', SLUGS)).toBeNull()
    expect(hqWaitingProject(null, null, SLUGS)).toBeNull()
  })

  it('without an HQ list keeps what it was given', () => {
    expect(hqWaitingProject('nope', 'acme-api', [])).toBe('nope')
    expect(hqWaitingProject(null, 'acme-api', [])).toBe('acme-api')
  })
})
