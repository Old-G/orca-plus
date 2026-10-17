import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../shared/constants'

const generate = vi.hoisted(() =>
  vi.fn(async (_prompt: string) => ({ ok: true as const, text: 'готово' }))
)
vi.mock('./hq-task-questions', () => ({ generateHqText: generate }))

import { rewriteHqVoiceText, saveHqIdea } from './hq-voice-prompts-service'

let dir: string | null = null
afterEach(async () => {
  if (dir) {
    await rm(dir, { recursive: true, force: true })
    dir = null
  }
  generate.mockClear()
})

async function hq(): Promise<string> {
  dir = await mkdtemp(join(tmpdir(), 'hq-voice-'))
  await mkdir(join(dir, 'wiki'))
  await writeFile(join(dir, 'wiki', 'tone.md'), 'Без смайликов.')
  return dir
}

const deps = {
  settings: getDefaultSettings('/tmp'),
  cwd: '/',
  getAgentEnvResolvers: () => undefined
}

describe('rewriteHqVoiceText', () => {
  it('adds the tone guide only for a message to a person', async () => {
    const path = await hq()
    await rewriteHqVoiceText({ mode: 'person', text: 'привет' }, path, deps)
    await rewriteHqVoiceText({ mode: 'agent', text: 'привет' }, path, deps)
    const prompts = generate.mock.calls.map(([prompt]) => prompt)
    expect(prompts[0]).toContain('Без смайликов.')
    expect(prompts[1]).not.toContain('Без смайликов.')
  })
})

describe('saveHqIdea', () => {
  it('files ideas by date and title without overwriting a same-titled one', async () => {
    const path = await hq()
    const day = new Date(2026, 9, 17)
    const first = await saveHqIdea('# Сводка почты\nутром', path, day)
    const second = await saveHqIdea('# Сводка почты\nвечером', path, day)
    expect(first).toEqual({ ok: true, path: join('ideas', '2026-10-17-сводка-почты.md') })
    expect(second).toEqual({ ok: true, path: join('ideas', '2026-10-17-сводка-почты-2.md') })
    expect(await readFile(join(path, 'ideas', '2026-10-17-сводка-почты.md'), 'utf8')).toContain(
      'утром'
    )
  })

  it('refuses without an HQ folder', async () => {
    expect(await saveHqIdea('x', null)).toEqual({ ok: false, error: 'No HQ folder is set.' })
  })
})
