import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { HqPlusCardFold, HqPlusCardShell } from './HqPlusCardShell'

const DIR = 'src/renderer/src/components/orca-plus/hq-plus'

describe('HqPlusCardShell', () => {
  it('draws an open card in one order: head, body, done, buttons, reply box, trailing, error, footer', () => {
    const html = renderToStaticMarkup(
      <HqPlusCardShell
        data-type="move"
        head={<i>head</i>}
        done="sent · 14:02"
        buttons={[
          { id: 'a', label: 'Yes', main: true, onClick: () => {} },
          { id: 'b', label: 'Got it', ghost: true, disabled: true, onClick: () => {} }
        ]}
        composer={<i>composer</i>}
        trailing={[{ id: 'n', label: 'Not now', ghost: true, onClick: () => {} }]}
        error="boom"
        footer={{ onCollapse: () => {} }}
      >
        <i>body</i>
      </HqPlusCardShell>
    )
    expect(html.startsWith('<div class="hqp-card" data-type="move"><div class="hqp-cb">')).toBe(
      true
    )
    const order = ['head', 'body', '✓ sent · 14:02', 'Yes', 'Got it', 'composer', 'Not now', 'boom']
    const at = order.map((text) => html.indexOf(text))
    expect(at.every((index) => index >= 0)).toBe(true)
    expect(at).toEqual([...at].sort((a, b) => a - b))
    expect(html).toContain('class="hqp-opt" data-main="true"')
    expect(html).toContain('class="hqp-opt" data-ghost="true" disabled=""')
    expect(html).toMatch(/class="hqp-row-f">.*Collapse/)
  })

  it('folds to the head and one line, with no body column', () => {
    const html = renderToStaticMarkup(
      <HqPlusCardShell
        head={<i>head</i>}
        folded={<HqPlusCardFold line="What next?" done="sent" onOpen={() => {}} />}
      >
        <i>body</i>
      </HqPlusCardShell>
    )
    expect(html).not.toContain('hqp-cb')
    expect(html).not.toContain('body')
    expect(html).toContain('class="hqp-cc"')
    expect(html).toContain('✓ sent')
  })

  it('leaves a chat card without the padded column and without an empty footer', () => {
    const html = renderToStaticMarkup(
      <HqPlusCardShell className="hqp-chatc" padded={false} head={<i>head</i>} footer={{}} />
    )
    expect(html).toBe('<div class="hqp-chatc"><i>head</i></div>')
  })

  it('is the only place the feed cards draw their head, buttons, fold and footer', () => {
    for (const file of [
      'HqPlusCard.tsx',
      'HqPlusChatCard.tsx',
      'HqPlusConversationCard.tsx',
      'HqPlusReportBody.tsx'
    ]) {
      const source = readFileSync(resolve(DIR, file), 'utf8')
      expect(source, file).toContain('HqPlusCardShell')
      for (const own of ['"hqp-row-h"', '"hqp-opts"', '"hqp-cc"', '"hqp-row-f"', '"hqp-opt"']) {
        expect(source, `${file} draws ${own} itself`).not.toContain(own)
      }
    }
  })
})
