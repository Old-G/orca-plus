import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { applyHqPlusPalette } from './hq-plus-theme'

function fakeRoot() {
  const attrs = new Map<string, string>()
  return {
    attrs,
    setAttribute: (name: string, value: string) => void attrs.set(name, value),
    removeAttribute: (name: string) => void attrs.delete(name)
  }
}

describe('applyHqPlusPalette', () => {
  it('puts the palette on the root for graphite and takes it off for classic', () => {
    const root = fakeRoot()
    applyHqPlusPalette(root, 'graphite')
    expect(root.attrs.get('data-hqp-palette')).toBe('graphite')
    applyHqPlusPalette(root, 'classic')
    expect(root.attrs.has('data-hqp-palette')).toBe(false)
  })
})

describe('hq-plus-palette.css', () => {
  const css = readFileSync(join(__dirname, 'hq-plus-palette.css'), 'utf8')
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '')

  it('matches nothing unless the palette attribute is on <html> (classic = the old look)', () => {
    const selectors = rules
      .split('{')
      .slice(0, -1)
      .map((chunk) => chunk.split('}').pop() ?? '')
      .flatMap((sel) => sel.split(','))
      .map((sel) => sel.trim())
      .filter(Boolean)
    expect(selectors.length).toBeGreaterThan(0)
    for (const sel of selectors) {
      expect(sel).toContain("[data-hqp-palette='graphite']")
    }
  })

  it('sets only tokens, no decoration rules', () => {
    const declarations = rules
      .split('{')
      .slice(1)
      .flatMap((chunk) => (chunk.split('}')[0] ?? '').split(';'))
      .map((d) => d.trim())
      .filter(Boolean)
    expect(declarations.every((d) => d.startsWith('--hqp-'))).toBe(true)
  })

  it('gives both themes the same set of tokens', () => {
    const blocks = rules.split('}').filter((b) => b.includes('{'))
    const names = blocks.map((b) => [...b.matchAll(/(--hqp-[a-z0-9-]+):/g)].map((m) => m[1]).sort())
    expect(names).toHaveLength(2)
    expect(names[1]).toEqual(expect.arrayContaining(names[0]!.filter((n) => n !== '--hqp-hi')))
  })
})
