import { describe, expect, it } from 'vitest'
import { hqSourceService } from './hq-source-link'

describe('hqSourceService', () => {
  it('knows a service only by its own host or a subdomain of it', () => {
    expect(hqSourceService('https://acme.slack.com/archives/C1/p1')).toBe('slack')
    expect(hqSourceService('https://slack.com/x')).toBe('slack')
    expect(hqSourceService('https://app.clickup.com/t/abc')).toBe('clickup')
    expect(hqSourceService('https://mail.google.com/mail/u/0/#inbox/1')).toBe('gmail')
    expect(hqSourceService('https://evilslack.com/x')).toBeNull()
    expect(hqSourceService('https://slack.com.evil.example/x')).toBeNull()
    expect(hqSourceService('http://acme.slack.com/x')).toBeNull()
    expect(hqSourceService('javascript:alert(1)')).toBeNull()
  })
})
