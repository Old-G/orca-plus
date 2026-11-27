import { describe, expect, it } from 'vitest'
import { sentText } from './outgoing-sent-fields'

describe('sentText', () => {
  it('cuts the Approve footer, the `w` work id (router v2 T1) and the older `id` alike', () => {
    expect(sentText('Done.\n\n_↳ acme › «W · export» · ref abc123 · w 1a2b3c4d_')).toBe('Done.')
    expect(sentText('Done.\n\n_↳ acme › «W · export» · ref abc123 · id 1a2b3c4d_')).toBe('Done.')
    expect(sentText('Done.\n\n_↳ acme · «W · export» · ref abc123_')).toBe('Done.')
  })
})
