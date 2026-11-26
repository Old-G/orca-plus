import { describe, expect, it } from 'vitest'
import { outgoingFooter } from './outgoing-approval/outgoing-footer'
import { hqCrumbChatId, hqCrumbIdMatches, parseHqCrumbs } from './hq-router-crumb'

const SESSION = '5a7fefad-4a7f-4676-bd5e-b46493c68fe9'

describe('router crumbs', () => {
  it('cuts a chat id to 8 hex, from either spelling', () => {
    expect(hqCrumbChatId(SESSION)).toBe('5a7fefad')
    expect(hqCrumbChatId('claude_5a7fefad_4a7f_4676')).toBe('5a7fefad')
    expect(hqCrumbIdMatches('5a7fefad', `claude_${SESSION.replace(/-/g, '_')}`)).toBe(true)
    expect(hqCrumbIdMatches('5a7f', SESSION)).toBe(false)
  })

  it('writes project › Lead › chat · task · ref · id and reads it back', () => {
    const footer = outgoingFooter({
      task: { id: 'DEV-1234', url: 'https://app.clickup.com/t/9/DEV-1234', name: null },
      project: 'acme-bot',
      chatName: 'W · T3 refunds',
      leadName: 'LEAD · Refunds',
      chatSessionId: SESSION,
      ref: 'abc123'
    })
    expect(footer).toBe(
      '↳ acme-bot › LEAD · Refunds › «W · T3 refunds» · [DEV-1234](https://app.clickup.com/t/9/DEV-1234) · ref abc123 · id 5a7fefad'
    )
    const [crumb] = parseHqCrumbs(`Ann, see above\n\n_${footer}_`)
    expect(crumb).toMatchObject({
      ref: 'abc123',
      chatId: '5a7fefad',
      chatTitle: 'W · T3 refunds',
      task: 'DEV-1234'
    })
  })

  it('reads the older footer without a Lead or id', () => {
    const [crumb] = parseHqCrumbs(
      '_↳ [DEV-18114](https://app.clickup.com/t/9/DEV-18114) · acme_tasks · «Core: status» · ref 3fa9c1_'
    )
    expect(crumb).toEqual({
      ref: '3fa9c1',
      chatId: null,
      chatTitle: 'Core: status',
      leadTitle: null,
      project: 'acme_tasks',
      task: 'DEV-18114'
    })
  })

  it('survives Slack wrapping, quoting and forwarding markup', () => {
    const text = [
      'Bob: ok, will do',
      '> Ann, the export is ready',
      '> _↳ acme › <https://app.clickup.com/t/9/DEV-77|DEV-77> nope',
      '> «Export chat» · ref 0a1b2c ·',
      '> id 1a2b3c4d_'
    ].join('\n')
    const [crumb] = parseHqCrumbs(text)
    expect(crumb?.ref).toBe('0a1b2c')
    expect(crumb?.chatId).toBe('1a2b3c4d')
    expect(crumb?.chatTitle).toBe('Export chat')
  })

  it('lists the newest footer first and nothing for plain text', () => {
    const text = '↳ a · «One» · ref aaaaaa\nlater\n↳ b · «Two» · ref bbbbbb'
    expect(parseHqCrumbs(text).map((c) => c.ref)).toEqual(['bbbbbb', 'aaaaaa'])
    expect(parseHqCrumbs('no footer here, ref abcdef')).toEqual([])
    expect(parseHqCrumbs(null)).toEqual([])
  })
})
