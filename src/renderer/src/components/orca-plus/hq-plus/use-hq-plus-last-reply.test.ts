import { describe, expect, it } from 'vitest'
import { hqPlusLastAssistantText } from './use-hq-plus-last-reply'

const reply = 'Done.\n\n- first\n- second\n\n```ts\nconst x = 1\n```'

describe('hqPlusLastAssistantText', () => {
  it('returns the newest assistant reply whole, skipping tool-only turns and user messages', () => {
    const items = [
      { body: { kind: 'message', role: 'assistant', blocks: [{ type: 'text', text: 'older' }] } },
      { body: { kind: 'message', role: 'assistant', blocks: [{ type: 'text', text: reply }] } },
      {
        body: { kind: 'message', role: 'assistant', blocks: [{ type: 'tool_use', name: 'Bash' }] }
      },
      { body: { kind: 'message', role: 'user', blocks: [{ type: 'text', text: 'thanks' }] } }
    ]
    expect(hqPlusLastAssistantText(items)).toBe(reply)
  })

  it('is null without an assistant text', () => {
    expect(hqPlusLastAssistantText([{ body: { kind: 'tool' } }, null])).toBeNull()
  })
})
