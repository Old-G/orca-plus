import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CustomCssSnapshot } from '../../shared/custom-css'
import { CustomCssService } from './custom-css-service'

const paths = vi.hoisted(() => ({ userData: '', home: '' }))

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => (name === 'userData' ? paths.userData : paths.home)
  }
}))

import { getCustomBuildCustomCssPath } from './custom-css-profile-location'

describe('custom build custom.css location', () => {
  let service: CustomCssService | null = null

  beforeEach(() => {
    paths.userData = mkdtempSync(join(tmpdir(), 'orca-custom-css-userdata-'))
    paths.home = mkdtempSync(join(tmpdir(), 'orca-custom-css-home-'))
  })

  afterEach(() => {
    service?.dispose()
    service = null
    rmSync(paths.userData, { recursive: true, force: true })
    rmSync(paths.home, { recursive: true, force: true })
  })

  it('lives in this profile userData, not in ~/.orca shared with the stock app', () => {
    expect(getCustomBuildCustomCssPath()).toBe(join(paths.userData, 'custom.css'))
  })

  it('reads and watches the overridden path', async () => {
    const onChanged = vi.fn<(snapshot: CustomCssSnapshot) => void>()
    service = new CustomCssService({
      homePath: paths.home,
      path: getCustomBuildCustomCssPath(),
      onChanged
    })
    const snapshot = service.ensureFile()
    expect(snapshot.path).toBe(join(paths.userData, 'custom.css'))

    writeFileSync(snapshot.path, '.dark { --background: #191d21; }')
    await vi.waitFor(() =>
      expect(onChanged).toHaveBeenLastCalledWith(
        expect.objectContaining({ css: '.dark { --background: #191d21; }' })
      )
    )
    expect(service.getPath()).toBe(join(paths.userData, 'custom.css'))
  })
})
