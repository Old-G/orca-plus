import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installBrowserGlobals } from './web-preload-api-test-harness'

describe('web preload API composition', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('gives the paired web client the Orca+ ClickUp and HQ projects APIs', async () => {
    const globals = installBrowserGlobals('Linux')
    const { installWebPreloadApi } = await import('./web-preload-api')
    installWebPreloadApi()

    // Custom build (hq-web): the paired web client gets our ClickUp and HQ projects APIs.
    expect(Object.keys(globals.window.api)).toEqual(expect.arrayContaining(['clickup', 'hqProjects']))
  })
})
