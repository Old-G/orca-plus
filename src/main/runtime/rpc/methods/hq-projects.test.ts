import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { getDefaultSettings } from '../../../../shared/constants'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import {
  createHqProjectPagesService,
  provideHqProjectPagesService
} from '../../../hq-project-pages/hq-project-pages-service'
import { RpcDispatcher } from '../dispatcher'
import { HQ_PROJECTS_METHODS } from './hq-projects'

function setup(initial: Partial<GlobalSettings>) {
  let settings: GlobalSettings = { ...getDefaultSettings('/home'), ...initial }
  const notified: boolean[] = []
  provideHqProjectPagesService(
    createHqProjectPagesService({
      getSettings: () => settings,
      updateSettings: (updates, options) => {
        notified.push(options?.notifyListeners === true)
        settings = { ...settings, ...updates }
        return settings
      },
      getRepo: () => undefined,
      getProjectGroups: () => []
    })
  )
  const host = { getRuntimeId: () => 'runtime-test', getSubscriptionRegistrationVersion: () => 0 }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the dispatcher reads only the two ids above; hqProjects.* use the provided service, not the runtime.
  const runtime = host as unknown as OrcaRuntimeService
  const dispatcher = new RpcDispatcher({ runtime, methods: HQ_PROJECTS_METHODS })
  const call = async (method: string, params?: unknown) => {
    const response = await dispatcher.dispatch({ id: randomUUID(), authToken: '', method, params })
    if (!response.ok) {
      throw new Error(`${response.error.code}: ${response.error.message}`)
    }
    return response.result
  }
  return { call, settings: () => settings, notified }
}

afterEach(() => {
  provideHqProjectPagesService(null)
})

describe('hqProjects RPC methods', () => {
  it('reads the HQ folder the desktop reads', async () => {
    const hq = mkdtempSync(join(tmpdir(), 'hq-rpc-'))
    mkdirSync(join(hq, 'wiki'))
    writeFileSync(join(hq, 'wiki', 'index.md'), '# HQ index\n')
    const { call } = setup({ hqPath: hq })

    await expect(call('hqProjects.wikiPage', { path: 'wiki/index.md' })).resolves.toEqual({
      ok: true,
      markdown: '# HQ index\n'
    })
    await expect(call('hqProjects.wikiTree')).resolves.toMatchObject({ ok: true })
    await expect(call('hqProjects.wikiPage', {})).rejects.toThrow(/invalid/i)
  })

  it('shares HQ settings and lets a client change only what HQ itself edits', async () => {
    const { call, settings, notified } = setup({
      hqPath: '/hq',
      hqDeferredAfterMinutes: 45,
      hqDeferredDismissed: { old: 1 }
    })

    await expect(call('hqProjects.settings')).resolves.toEqual({
      hqPath: '/hq',
      hqProjectClickUpLists: {},
      hqDeferredAfterMinutes: 45,
      hqDeferredDismissed: { old: 1 },
      hqTriageDecisions: {}
    })

    await call('hqProjects.updateSettings', {
      hqDeferredDismissed: { pane: 2 },
      hqTriageDecisions: { t1: { decision: 'taken', at: 3, repoId: 'repo-api' } },
      hqPath: '/elsewhere',
      hqDeferredAfterMinutes: 1
    })
    expect(settings().hqDeferredDismissed).toEqual({ pane: 2 })
    expect(settings().hqTriageDecisions).toEqual({
      t1: { decision: 'taken', at: 3, repoId: 'repo-api' }
    })
    expect(settings().hqPath).toBe('/hq')
    expect(settings().hqDeferredAfterMinutes).toBe(45)
    expect(notified).toEqual([true])
    await expect(
      call('hqProjects.updateSettings', {
        hqTriageDecisions: { t2: { decision: 'deploy', at: 1 } }
      })
    ).rejects.toThrow(/invalid/i)
  })

  it('says so when the host has no HQ service', async () => {
    const { call } = setup({})
    provideHqProjectPagesService(null)
    await expect(call('hqProjects.list')).rejects.toThrow('HQ is not available on this host.')
  })
})
