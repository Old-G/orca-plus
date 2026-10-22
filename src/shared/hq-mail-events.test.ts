import { describe, expect, it } from 'vitest'
import { hqMailEvent, hqMergeRequestKey, type HqMail } from './hq-mail-events'

function mail(overrides: Partial<HqMail>): HqMail {
  return { id: 'm1', from: '', subject: '', body: '', receivedAt: 1, ...overrides }
}

// Why: ClickUp's links as they arrive — a tracking redirect wrapping an encoded redirect.
const clickUpLink = (tail: string): string =>
  `https://link-inbox.clickup.com/CL0/https:%2F%2Fapp-landing.web.clickup.com%3Fredirect=https%253A%252F%252Fapp.clickup.com%252Ft%252F${tail}%2526utm_source%253Demail-notifications/1/0100/abc=452`

describe('hqMailEvent', () => {
  it('reads a merged MR from a GitLab email', () => {
    expect(
      hqMailEvent(
        mail({
          from: 'Acme GitLab <gitlab@mg.gitlab.com>',
          subject: 'Re: Hub | Draft rule (!215)',
          body: 'Merge request !215 was merged\nMerge request URL: https://gitlab.com/acme/hub/-/merge_requests/215\nBranches: mcp/x to main'
        })
      )
    ).toEqual({
      kind: 'mr-merged',
      mrUrl: 'https://gitlab.com/acme/hub/-/merge_requests/215',
      host: 'gitlab.com',
      projectPath: 'acme/hub',
      iid: 215
    })
  })

  it('ignores the other GitLab events', () => {
    const body =
      'Merge request !19 can no longer be merged due to conflict.\nhttps://gitlab.com/acme/svc/-/merge_requests/19'
    expect(hqMailEvent(mail({ from: 'gitlab@mg.gitlab.com', body }))).toBeNull()
  })

  it('finds the comment a ClickUp mention links to', () => {
    expect(
      hqMailEvent(
        mail({
          from: 'ClickUp <notifications@tasks.clickup.com>',
          subject: 'Review Auto-Hold Logic',
          body: `Ann Lee mentioned you: @Owner I'll share cases.\nView comment ${clickUpLink('86abc1xyz%253Fcomment%253D1000000000000001')}`
        })
      )
    ).toEqual({ kind: 'clickup-comment', taskRef: '86abc1xyz', commentId: '1000000000000001' })
  })

  it('reads who shared or assigned a task', () => {
    expect(
      hqMailEvent(
        mail({
          from: 'notifications@tasks.clickup.com',
          subject: 'Ann Lee shared a task with you',
          body: `View task ${clickUpLink('86abc1xyz%253Futm_field%253Dshared_with_me')}`
        })
      )
    ).toEqual({ kind: 'clickup-task', taskRef: '86abc1xyz', action: 'shared', by: 'Ann Lee' })
    expect(
      hqMailEvent(
        mail({
          from: 'notifications@tasks.clickup.com',
          subject: '[hub] Invite on thanks',
          body: `AI Acme IT assigned task to you\n${clickUpLink('9%252FDEV-18114')}`
        })
      )
    ).toEqual({ kind: 'clickup-task', taskRef: 'DEV-18114', action: 'assigned', by: 'Acme IT' })
  })

  it('leaves ClickUp status changes and the Slack mirror alone', () => {
    const link = clickUpLink('86ca%253Fcomment%253D1')
    for (const body of [
      `Acme IT set the status to: check\n${link}`,
      `Acme IT: [Slack Sync] 💬 @Owner (Slack): done\n${link}`
    ]) {
      expect(hqMailEvent(mail({ from: 'notifications@tasks.clickup.com', body }))).toBeNull()
    }
  })

  it('reads nothing from other senders', () => {
    expect(
      hqMailEvent(
        mail({
          from: 'someone@example.com',
          body: 'Merge request !1 was merged https://gitlab.com/a/b/-/merge_requests/1'
        })
      )
    ).toBeNull()
  })
})

describe('hqMergeRequestKey', () => {
  it('matches an MR whatever its link ends with', () => {
    expect(hqMergeRequestKey('https://gitlab.com/Acme/Hub/-/merge_requests/215/diffs#note_1')).toBe(
      hqMergeRequestKey('https://gitlab.com/acme/hub/-/merge_requests/215')
    )
    expect(hqMergeRequestKey('https://gitlab.com/acme/hub/-/merge_requests/21')).not.toBe(
      hqMergeRequestKey('https://gitlab.com/acme/hub/-/merge_requests/215')
    )
  })
})
