import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { applyHqPlusDecor } from './hq-plus-theme'

function fakeRoot() {
  const attrs = new Map<string, string>()
  return {
    attrs,
    setAttribute: (name: string, value: string) => void attrs.set(name, value),
    removeAttribute: (name: string) => void attrs.delete(name)
  }
}

describe('applyHqPlusDecor', () => {
  it('puts calm on the root and takes it off for full', () => {
    const root = fakeRoot()
    applyHqPlusDecor(root, 'calm')
    expect(root.attrs.get('data-hqp-decor')).toBe('calm')
    applyHqPlusDecor(root, 'full')
    expect(root.attrs.has('data-hqp-decor')).toBe(false)
  })
})

describe('hq-plus-calm.css', () => {
  const css = readFileSync(join(__dirname, 'hq-plus-calm.css'), 'utf8')
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '')

  it('matches nothing unless calm is on <html> (full = the old look)', () => {
    const selectors = rules
      .split('{')
      .slice(0, -1)
      .map((chunk) => chunk.split('}').pop() ?? '')
      .flatMap((sel) => sel.split(','))
      .map((sel) => sel.trim().replace(/\s+/g, ' '))
      .filter(Boolean)
    expect(selectors.length).toBeGreaterThan(10)
    for (const sel of selectors) {
      expect(sel.startsWith("html[data-hqp-decor='calm'] ")).toBe(true)
    }
  })

  it('is imported by the HQ+ screen', () => {
    const screen = readFileSync(join(__dirname, 'HqPlusScreen.tsx'), 'utf8')
    expect(screen).toContain("import './hq-plus-calm.css'")
  })

  it('takes off the decoration it names: spots, glows, capitals, the Approve bar', () => {
    expect(rules).toMatch(/\.hq-plus::before\s*\{[^}]*content:\s*none/)
    expect(rules).toMatch(/box-shadow:\s*none/)
    expect(rules).toMatch(/text-transform:\s*none/)
    expect(rules).toMatch(/\.hqpc-apbar\s*\{\s*display:\s*none/)
  })

  it('does not touch what carries meaning: no rule hides a pill or the Approve section', () => {
    expect(rules).not.toMatch(/hqpc-pill/)
    expect(rules).not.toMatch(/approve-host/)
  })
})
