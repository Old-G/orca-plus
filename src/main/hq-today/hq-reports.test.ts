import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hqReportChatName, hqReportDecisionsPrompt } from '../../shared/hq-reports'
import type { PulseBellInput } from '../../shared/pulse-bell'
import { listHqReports, refreshHqReportBell } from './hq-reports'

const NOW = Date.parse('2026-10-18T12:00:00Z')
let hq: string

function report(path: string, text: string, at: number): void {
  const full = join(hq, path)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, text)
  utimesSync(full, at / 1000, at / 1000)
}

beforeEach(() => {
  hq = mkdtempSync(join(tmpdir(), 'hq-reports-'))
})
afterEach(() => rmSync(hq, { recursive: true, force: true }))

describe('HQ reports', () => {
  it('lists markdown reports from the report folders, newest first, titled by their heading', async () => {
    report(
      'improvements/2026-W42.md',
      '---\nweek: 42\n---\n# Неделя 42: что улучшить\n',
      NOW - 1_000
    )
    report('improvements/2026-W42-input.json', '{}', NOW)
    report('meetings/2026-10-17-sync.md', 'без заголовка', NOW - 500)
    report('wiki/index.md', '# Wiki', NOW)
    expect(await listHqReports(hq)).toEqual([
      {
        path: 'meetings/2026-10-17-sync.md',
        title: '2026-10-17-sync',
        folder: 'meetings',
        at: NOW - 500
      },
      {
        path: 'improvements/2026-W42.md',
        title: 'Неделя 42: что улучшить',
        folder: 'improvements',
        at: NOW - 1_000
      }
    ])
  })

  it('rings the bell for recent reports and pushes only one written after the first pass', async () => {
    report('improvements/2026-W41.md', '# W41', NOW - 10 * 86_400_000)
    report('improvements/2026-W42.md', '# W42', NOW - 1_000)
    const synced: PulseBellInput[][] = []
    const notify = vi.fn()
    const deps = {
      hqPath: () => hq,
      sync: (_kind: string, items: readonly PulseBellInput[]) => {
        synced.push([...items])
        return items.length
      },
      notify,
      now: () => NOW
    }
    const known = await refreshHqReportBell(deps, null)
    expect(synced[0].map((item) => item.refId)).toEqual(['improvements/2026-W42.md'])
    expect(notify).not.toHaveBeenCalled()
    report('status-update/2026-10-18.md', '# Статус Жене', NOW)
    await refreshHqReportBell(deps, known)
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify.mock.calls[0][0]).toMatchObject({ title: 'Статус Жене' })
  })

  it('tells the chat how to carry out the decisions for each kind of report', () => {
    expect(
      hqReportDecisionsPrompt(
        { path: 'improvements/2026-W42.md', folder: 'improvements' },
        ' 1 да '
      )
    ).toBe(
      'Решения по отчёту improvements/2026-W42.md:\n1 да\n\nПримени по скиллу weekly-improve, шаг 5: только то, на что я сказал «да», и отметь в отчёте «Применено».'
    )
    expect(hqReportDecisionsPrompt({ path: 'meetings/a.md', folder: 'meetings' }, 'ок')).toContain(
      'только через Approve'
    )
    expect(hqReportChatName('improvements/2026-W42.md')).toBe('Report · 2026-W42')
  })
})
