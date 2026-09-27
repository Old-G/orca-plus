import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createFileHandledStore, strataContextGateFired } from './claude-handoff-offer-state'

const dirs: string[] = []
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'handoff-offer-state-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('strataContextGateFired', () => {
  it('reads the marker Strata leaves in its gate directory', () => {
    const tmp = tempDir()
    mkdirSync(join(tmp, 'strata-context-gate'))
    writeFileSync(join(tmp, 'strata-context-gate', 'session-a'), '1')
    expect(strataContextGateFired('session-a', { TMPDIR: tmp })).toBe(true)
    expect(strataContextGateFired('session-b', { TMPDIR: tmp })).toBe(false)
  })

  it('honours STRATA_CONTEXT_GATE_DIR and refuses path-like ids', () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'session-a'), '1')
    expect(strataContextGateFired('session-a', { STRATA_CONTEXT_GATE_DIR: dir })).toBe(true)
    expect(strataContextGateFired('../session-a', { STRATA_CONTEXT_GATE_DIR: dir })).toBe(false)
  })
})

describe('createFileHandledStore', () => {
  it('remembers handled handoffs across instances', () => {
    const file = join(tempDir(), 'claude-handoff-handled.json')
    createFileHandledStore(file).add('session-a\n2026-09-30T21:11:00Z')
    expect(createFileHandledStore(file).has('session-a\n2026-09-30T21:11:00Z')).toBe(true)
    expect(createFileHandledStore(file).has('session-b\n2026-09-30T21:11:00Z')).toBe(false)
  })

  it('starts empty on a missing or broken file', () => {
    const file = join(tempDir(), 'broken.json')
    writeFileSync(file, '{not json')
    expect(createFileHandledStore(file).has('x')).toBe(false)
  })
})
