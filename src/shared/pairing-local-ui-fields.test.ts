import { describe, expect, it } from 'vitest'
import { omitPairingLocalUiFields, PAIRING_LOCAL_UI_FIELDS } from './pairing-local-ui-fields'

describe('pairing-local UI fields', () => {
  // Custom build (web-phone): each paired client keeps its own right sidebar open or closed.
  it('keeps the right sidebar state local to each pairing', () => {
    expect([...PAIRING_LOCAL_UI_FIELDS]).toContain('rightSidebarOpen')
  })

  it('omits every member and keeps everything else', () => {
    const state = {
      hideWorkspacesFromOtherDevices: true,
      manualRepoOrder: [{ hostId: 'local' as const, repoId: 'repo-a' }],
      workspaceHostOrder: ['local' as const],
      showAgentModels: false,
      sidebarWidth: 280,
      activeView: 'tasks' as const
    }

    expect(omitPairingLocalUiFields(state)).toEqual({ sidebarWidth: 280, activeView: 'tasks' })
  })

  // Present undefined still looks like a clear operation to receivers; drop the key itself.
  it('drops a member present with an undefined value', () => {
    expect(
      Object.keys(omitPairingLocalUiFields({ manualRepoOrder: undefined, sidebarWidth: 280 }))
    ).toEqual(['sidebarWidth'])
  })
})
