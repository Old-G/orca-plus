import { describe, expect, it } from 'vitest'
import { isSafeUrl } from './markdown-escaping'
import { renderInline } from './markdown-inline-render'

describe('isSafeUrl', () => {
  it.each([
    'javascript:alert(1)',
    ' JavaScript:alert(1)',
    '&#106;avascript:alert(1)',
    '&#x6A;avascript:alert(1)',
    'java\tscript:alert(1)',
    'java&#9;script:alert(1)',
    '\u0001javascript:alert(1)',
    'vbscript:msgbox(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd'
  ])('rejects %j', (url) => {
    expect(isSafeUrl(url)).toBe(false)
  })

  it.each([
    'https://example.com/a?b=c#d',
    'HTTP://example.com',
    'mailto:ann@example.com',
    './notes/plan.md',
    '/docs/readme.md',
    '#section',
    '&amp;#106;avascript:alert(1)'
  ])('accepts %j', (url) => {
    expect(isSafeUrl(url)).toBe(true)
  })
})

describe('renderInline links', () => {
  it('does not turn an entity-encoded javascript: link into an anchor or image', () => {
    const html = renderInline('[x](&#106;avascript:alert(1)) ![y](&#x6A;avascript:alert(1))')
    expect(html).not.toMatch(/<a |<img /)
  })

  it('keeps an ordinary link', () => {
    expect(renderInline('[site](https://example.com)')).toBe(
      '<a href="https://example.com">site</a>'
    )
  })
})
