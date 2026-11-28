// @vitest-environment happy-dom

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HqPlusProjectChips } from './HqPlusProjectFeed'

vi.mock('./use-hq-plus-new-marks', () => ({ observeHqPlusNewRows: () => () => {} }))

const dir = __dirname
const css = (name: string): string => readFileSync(join(dir, name), 'utf8')
const counts = { approve: 2, asks: 0, move: 1, wait: 3, fyi: 0 }

afterEach(cleanup)

describe("one rule for a card's text (U4)", () => {
  it('has no own pixel or em limit left on the nine text parts', () => {
    const all = css('hq-plus.css') + css('hq-plus-project-cards.css')
    const own = [
      '.hqp-text',
      '.hqp-chatc-full',
      '.hqp-chatc-text',
      ".hqp-chatc-text[data-open='true']",
      '.hqp-q',
      ".hqp-said[data-folded='true']",
      '.hqpc-said2',
      '.hqpc-ap .hqp-approve-host pre',
      '.hqp-wf > span.hqp-qtext'
    ]
    for (const selector of own) {
      const at = all.indexOf(`${selector} {`)
      expect(at, selector).toBeGreaterThan(-1)
      const body = all.slice(at, all.indexOf('}', at))
      expect(body, selector).not.toMatch(/max-height:\s*\d/)
      expect(body, selector).not.toMatch(/line-clamp:\s*\d/)
    }
  })

  it('defines the fold, open limit and body font once', () => {
    const base = css('hq-plus.css')
    expect(base).toMatch(/--hqp-fold-lines:\s*3;/)
    expect(base).toMatch(/--hqp-open-max:\s*70vh;/)
    expect(base).toMatch(/--hqp-body-fs:\s*13\.5px;/)
    expect(base).toMatch(/--hqp-body-lh:\s*1\.5;/)
  })

  it('sticks the decision row to the bottom of the card', () => {
    expect(css('hq-plus-project-cards.css')).toMatch(
      /\.hqp-approve-host \[data-approval-decide='true'\] \{\s*position: sticky;\s*bottom: 0;/
    )
  })
})

describe('«All ▾» filter menu (U4)', () => {
  it('shows the chosen filter and opens the six with counts', () => {
    const onFilter = vi.fn()
    render(<HqPlusProjectChips filter="all" counts={counts} onFilter={onFilter} />)
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /All/ }))
    expect(screen.getAllByRole('menuitemradio')).toHaveLength(6)
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Approve/ }))
    expect(onFilter).toHaveBeenCalledWith('approve')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('wears the chosen filter and flags a waiting Approve', () => {
    render(<HqPlusProjectChips filter="move" counts={counts} onFilter={() => {}} />)
    const button = screen.getByRole('button', { name: /Your move/ })
    expect(button.getAttribute('data-ap')).toBe('true')
    expect(button.textContent).toContain('▾')
  })
})
