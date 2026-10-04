import { describe, expect, it, vi } from 'vitest'
import { registerWebServiceWorker } from './web-service-worker'

describe('registerWebServiceWorker', () => {
  it('registers the worker beside the page in a secure context', () => {
    const register = vi.fn(async () => {
      throw new Error('unused')
    })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    registerWebServiceWorker({ serviceWorker: { register } }, true)
    expect(register).toHaveBeenCalledWith('./sw.js')
  })

  it('does nothing over plain HTTP or without service worker support', () => {
    const register = vi.fn()
    registerWebServiceWorker({ serviceWorker: { register } }, false)
    registerWebServiceWorker({}, true)
    expect(register).not.toHaveBeenCalled()
  })
})
