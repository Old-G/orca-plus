import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { HqPlusWaitsView } from './HqPlusWaitsView'
import type { HqPlusOtherWait, HqPlusQueueActions } from './HqPlusSideQueues'
import type { HqPlusLogContext } from './HqPlusLog'

vi.mock('./HqPlusWeWaitCard', () => ({
  HqPlusWeWaitCard: ({ wait }: { wait: HqPlusOtherWait }) => <div>{wait.title}</div>
}))
vi.mock('./HqPlusLog', () => ({ HqPlusLog: () => <div /> }))

const css = readFileSync(
  resolve('src/renderer/src/components/orca-plus/hq-plus/hq-plus.css'),
  'utf8'
)

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? ''
}

const wait: HqPlusOtherWait = {
  id: 'w1',
  who: 'Ann',
  title: 'Merge !12',
  detail: null,
  link: null,
  project: 'Acme',
  at: 1,
  sessionId: null,
  rawDetail: null,
  task: null,
  snoozedUntil: null,
  checked: null
}

describe('HqPlusWaitsView', () => {
  it('scrolls inside the feed instead of pushing the composer off screen', () => {
    const html = renderToStaticMarkup(
      <HqPlusWaitsView
        waits={[wait]}
        actions={{} as HqPlusQueueActions}
        ctx={{} as HqPlusLogContext}
      />
    )
    expect(html).toMatch(/class="hqp-waits scrollbar-sleek"/)
    expect(rule('.hqp-feed > .hqp-waits')).toMatch(/flex:\s*1 1 0/)
    expect(rule('.hqp-waits')).toMatch(/overflow:\s*auto/)
    expect(rule('.hqp-waits')).toMatch(/min-height:\s*0/)
  })
})
