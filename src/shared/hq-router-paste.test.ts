import { describe, expect, it } from 'vitest'
import { hqRouterPasteAuthor, hqRouterPasteParts } from './hq-router-paste'

const A = 'https://acme.slack.com/archives/C0ABC123/p1764100000123456'
const B =
  'https://acme.slack.com/archives/D0XYZ789/p1764100100654321?thread_ts=1764100000.123456&cid=D0XYZ789'

describe('hqRouterPasteParts', () => {
  it('makes one card per link and none for the words between them', () => {
    expect(hqRouterPasteParts(`${A}\nи\n${B}`)).toEqual({ links: [A, B], text: null })
  })

  it('keeps a link once', () => {
    expect(hqRouterPasteParts(`${A} ${A}`).links).toEqual([A])
  })

  it('keeps the text around links as one more message', () => {
    expect(hqRouterPasteParts(`Bob wrote: the export is broken\n${A}`)).toEqual({
      links: [A],
      text: 'Bob wrote: the export is broken'
    })
  })

  it('takes plain text whole', () => {
    expect(hqRouterPasteParts('  Ann says the build is green  ')).toEqual({
      links: [],
      text: 'Ann says the build is green'
    })
  })

  it('ignores a link that is not a Slack message', () => {
    expect(hqRouterPasteParts('see https://example.com/x').links).toEqual([])
  })
})

describe('hqRouterPasteAuthor', () => {
  it('reads the name from «Name wrote:»', () => {
    expect(hqRouterPasteAuthor('Боб написал: доступ выдан')).toBe('Боб')
    expect(hqRouterPasteAuthor('Ann Lee wrote: ok')).toBe('Ann Lee')
  })

  it('is null when the text names nobody', () => {
    expect(hqRouterPasteAuthor('доступ выдан, можно проверять')).toBeNull()
  })
})
