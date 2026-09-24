import { mkdtempSync, readdirSync, rmSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  importBackgroundImage,
  readBackgroundImage,
  removeBackgroundImages
} from './background-image-store'

describe('background image store', () => {
  let root: string
  let dir: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'orca-bg-'))
    dir = join(root, 'appearance')
  })

  afterEach(() => rmSync(root, { recursive: true, force: true }))

  function source(name: string, bytes = 'png-bytes'): string {
    const path = join(root, name)
    writeFileSync(path, bytes)
    return path
  }

  it('copies the image into the profile and keeps only the newest', async () => {
    const first = await importBackgroundImage(source('a.PNG'), dir)
    const second = await importBackgroundImage(source('b.jpg', 'jpg-bytes'), dir)
    expect(first).toMatch(/^background-[0-9a-f-]{36}\.png$/)
    expect(readdirSync(dir)).toEqual([second])
    expect((await readBackgroundImage(dir, second))?.toString()).toBe('jpg-bytes')
  })

  it('refuses other types, missing files and oversized images', async () => {
    await expect(importBackgroundImage(source('a.svg'), dir)).rejects.toMatchObject({
      code: 'unsupported'
    })
    await expect(importBackgroundImage(join(root, 'nope.png'), dir)).rejects.toMatchObject({
      code: 'unreadable'
    })
    const big = source('big.png')
    truncateSync(big, 26 * 1024 * 1024)
    await expect(importBackgroundImage(big, dir)).rejects.toMatchObject({ code: 'too-large' })
  })

  it('never reads outside its folder', async () => {
    writeFileSync(join(root, 'secret.png'), 'secret')
    expect(await readBackgroundImage(dir, '../secret.png')).toBeNull()
  })

  it('clears every stored background but leaves other files alone', async () => {
    const name = await importBackgroundImage(source('a.png'), dir)
    writeFileSync(join(dir, 'keep.txt'), 'x')
    await removeBackgroundImages(dir)
    expect(readdirSync(dir)).toEqual(['keep.txt'])
    expect(await readBackgroundImage(dir, name)).toBeNull()
  })
})
