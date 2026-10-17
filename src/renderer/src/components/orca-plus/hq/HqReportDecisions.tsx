// Custom build (hq-reports): under a report, the owner says or types what to do with it — approve,
// reject, change — and Send starts an HQ chat that carries it out. Nothing goes to people from here.
import { useRef, useState } from 'react'
import { Send } from 'lucide-react'
import { toast } from 'sonner'
import type { HqReport } from '../../../../../shared/hq-reports'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { translate } from '@/i18n/i18n'
import { isWebClientLocation } from '@/lib/web-client-location'
import { useAppStore } from '@/store'
import { HqCommandDictation } from './HqCommandDictation'
import { startHqReportDecisions } from './hq-ask-chat'
import { findHqWorktreeId } from './hq-today-actions'

type Sent = { ok: true } | { ok: false; message: string }

async function sendDecisions(
  report: HqReport,
  text: string,
  hqWorktreeId: string | null
): Promise<Sent> {
  const onDesktop = window.api.hqProjects.reportDecisionsOnDesktop
  // Why: on the phone the chat starts in the Mac's window, where HQ's chats live.
  if (isWebClientLocation() && onDesktop) {
    const result = await onDesktop({ path: report.path, text })
    return result.ok ? result : { ok: false, message: result.error }
  }
  if (!hqWorktreeId) {
    return {
      ok: false,
      message: translate(
        'auto.hq.reports.noHq',
        'Add the HQ folder as a project to send decisions.'
      )
    }
  }
  return startHqReportDecisions(hqWorktreeId, report, text)
}

export function HqReportDecisions({ report }: { report: HqReport }): React.JSX.Element {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const hqWorktreeId = useAppStore((s) =>
    findHqWorktreeId(s.settings?.hqPath, s.repos, s.worktreesByRepo)
  )
  const send = async (): Promise<void> => {
    setBusy(true)
    const result = await sendDecisions(report, text.trim(), hqWorktreeId).catch(
      (error: unknown): Sent => ({ ok: false, message: String(error) })
    )
    setBusy(false)
    if (result.ok) {
      setText('')
      toast.success(
        translate('auto.hq.reports.sent', 'Sent to an HQ chat — it carries out your decisions.')
      )
    } else {
      toast.error(result.message)
    }
  }
  return (
    <div className="flex flex-col gap-1.5 border-t border-border bg-background p-3">
      <div className="flex items-start gap-2">
        <Textarea
          ref={textareaRef}
          className="max-h-48 min-h-20 flex-1"
          value={text}
          disabled={busy}
          placeholder={translate(
            'auto.hq.reports.placeholder',
            'Your decisions: «1 yes, 2 no, 3 change to …» — say it or type it'
          )}
          onChange={(event) => setText(event.target.value)}
          aria-label={translate('auto.hq.reports.decisions', 'Decisions on this report')}
        />
        <HqCommandDictation textareaRef={textareaRef} disabled={busy} />
      </div>
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" disabled={busy || !text.trim()} onClick={() => void send()}>
          <Send />
          {busy
            ? translate('auto.hq.reports.sending', 'Sending…')
            : translate('auto.hq.reports.send', 'Send decisions')}
        </Button>
        <p className="min-w-0 flex-1 text-[11px] text-muted-foreground">
          {translate(
            'auto.hq.reports.sendHint',
            'Opens a new HQ chat with the report and your words. Messages to people still wait for your Approve.'
          )}
        </p>
      </div>
    </div>
  )
}
