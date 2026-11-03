import { describe, expect, it } from 'vitest'
import type { HqSlackLedgerMessage } from './hq-slack-ledger-reader'
import { hqIntakeThreadOf } from './hq-intake-thread'

const line = (
  ts: string,
  user: string | null,
  text: string,
  bot = false
): HqSlackLedgerMessage => ({
  channel: 'C0ACME',
  ts,
  threadTs: '1.0',
  user,
  text,
  rawText: text,
  permalink: null,
  dm: false,
  bot
})

// Custom build (hq-intake-thread, owner 03.11): the chat got the last five lines and no task link.
describe('hqIntakeThreadOf', () => {
  it('gives the request, the owner as «You», the bot and every link in the thread', async () => {
    const thread = await hqIntakeThreadOf(
      [
        line('1.0', 'U_ANN', 'Could we connect Search Console to the shop MCP?'),
        line('1.1', null, 'Task created: https://app.clickup.com/t/31632516/DEV-18635.', true),
        line('1.2', 'U_OWNER', 'Принял, see https://gitlab.com/acme/shop/-/merge_requests/7'),
        line('1.3', 'U_ANN', '   '),
        line('1.4', 'U_ANN', 'Я только рад)')
      ],
      'U_OWNER',
      async (id) => (id === 'U_ANN' ? 'Ann' : id)
    )
    expect(thread).toEqual({
      lines: [
        'Ann: Could we connect Search Console to the shop MCP?',
        'Bot: Task created: https://app.clickup.com/t/31632516/DEV-18635.',
        'You: Принял, see https://gitlab.com/acme/shop/-/merge_requests/7',
        'Ann: Я только рад)'
      ],
      links: [
        'https://app.clickup.com/t/31632516/DEV-18635',
        'https://gitlab.com/acme/shop/-/merge_requests/7'
      ]
    })
  })

  it('a long thread keeps its root and the newest lines', async () => {
    const messages = Array.from({ length: 50 }, (_, index) =>
      line(`1.${index}`, 'U_BOB', `m${index}`)
    )
    const { lines } = await hqIntakeThreadOf(messages, 'U_OWNER', async () => 'Bob')
    expect(lines).toHaveLength(41)
    expect(lines.slice(0, 3)).toEqual(['Bob: m0', '…', 'Bob: m11'])
    expect(lines.at(-1)).toBe('Bob: m49')
  })
})
