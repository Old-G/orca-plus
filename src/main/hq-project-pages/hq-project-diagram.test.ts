import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { pickHqProjectDiagram, readHqProjectDiagram } from './hq-project-diagram'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'hq-diagram-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('pickHqProjectDiagram', () => {
  it('prefers the system diagram, else the first page by name, never a visual check', () => {
    expect(pickHqProjectDiagram(['flow.html', 'system.html', 'a.json'])).toBe('system.html')
    expect(pickHqProjectDiagram(['b.html', 'a.visual-check.html', 'c.html'])).toBe('b.html')
    expect(pickHqProjectDiagram(['system.architecture.json'])).toBeNull()
  })
})

describe('readHqProjectDiagram', () => {
  it('reads the chosen page from the checkout', async () => {
    mkdirSync(join(root, 'wiki', 'diagrams', 'history'), { recursive: true })
    writeFileSync(join(root, 'wiki', 'diagrams', 'system.html'), '<html>system</html>')
    writeFileSync(join(root, 'wiki', 'diagrams', 'system.visual-check.html'), 'x')
    expect(await readHqProjectDiagram({ path: root })).toEqual({
      ok: true,
      html: '<html>system</html>',
      name: 'system.html'
    })
  })

  it('says none when the project has no diagrams folder', async () => {
    expect(await readHqProjectDiagram({ path: root })).toEqual({ ok: false, reason: 'none' })
  })

  it('does not read a checkout on another host', async () => {
    mkdirSync(join(root, 'wiki', 'diagrams'), { recursive: true })
    writeFileSync(join(root, 'wiki', 'diagrams', 'system.html'), 'x')
    expect(await readHqProjectDiagram({ path: root, connectionId: 'ssh-1' })).toEqual({
      ok: false,
      reason: 'remote'
    })
    expect(
      await readHqProjectDiagram({ path: root, executionHostId: 'runtime:box' })
    ).toMatchObject({ reason: 'remote' })
  })

  it('fails for an unknown project', async () => {
    expect(await readHqProjectDiagram(undefined)).toMatchObject({ ok: false, reason: 'failed' })
  })
})
