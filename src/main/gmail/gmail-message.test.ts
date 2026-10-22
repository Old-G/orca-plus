import { describe, expect, it } from 'vitest'
import { hqMailEvent } from '../../shared/hq-mail-events'
import { gmailMessageToMail } from './gmail-message'

const b64 = (text: string): string => Buffer.from(text, 'utf-8').toString('base64url')

// Why: the shape of a real ClickUp mention — HTML only, tags split across lines, ids in title markers.
const CLICKUP_HTML = `<html><head><style>.a{}</style></head><body>
<td style="x">\r\n  LA\r\n</td>
<span class="fs_14">\r\n Ann Lee \r\n <span style="font-weight:600;">\r\n mentioned you\r\n </span></span>
<p><span class="cu-mention-me">@Owner</span>  I&#39;ll share cases &amp; more.</p>
<a\r\n href="https://link-inbox.clickup.com/CL0/https:%2F%2Fapp.clickup.com%2F1000001%2Fsettings/1/x=452">Manage</a>
<div style="margin:0" title="task_id_start-86abc1xyz-task_id_end"></div>
<div style="margin:0" title="comment_id_start-1000000000000001-comment_id_end"></div>
</body></html>`

describe('gmailMessageToMail', () => {
  it('reads an HTML-only ClickUp email down to its task and comment', () => {
    const mail = gmailMessageToMail({
      id: 'm1',
      internalDate: '1790000000000',
      payload: {
        mimeType: 'multipart/alternative',
        headers: [
          { name: 'From', value: 'ClickUp <notifications@tasks.clickup.com>' },
          { name: 'Subject', value: 'Review Auto-Hold Logic' }
        ],
        parts: [{ mimeType: 'text/html', body: { data: b64(CLICKUP_HTML) } }]
      }
    })
    expect(mail).toMatchObject({
      id: 'm1',
      subject: 'Review Auto-Hold Logic',
      receivedAt: 1790000000000
    })
    expect(mail?.body).toContain('Ann Lee')
    expect(mail?.body).not.toContain('.a{}')
    expect(mail && hqMailEvent(mail)).toEqual({
      kind: 'clickup-comment',
      taskRef: '86abc1xyz',
      commentId: '1000000000000001'
    })
  })

  it('prefers the plain part and still keeps the HTML links', () => {
    const mail = gmailMessageToMail({
      id: 'm2',
      payload: {
        mimeType: 'multipart/alternative',
        headers: [{ name: 'From', value: 'gitlab@mg.gitlab.com' }],
        parts: [
          { mimeType: 'text/plain', body: { data: b64('Merge request !7 was merged') } },
          {
            mimeType: 'text/html',
            body: { data: b64('<a href="https://gitlab.com/acme/svc/-/merge_requests/7">!7</a>') }
          }
        ]
      }
    })
    expect(mail && hqMailEvent(mail)).toMatchObject({
      kind: 'mr-merged',
      iid: 7,
      projectPath: 'acme/svc'
    })
  })
})
