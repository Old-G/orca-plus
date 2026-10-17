// Custom build (hq-scout-digest): what the Slack scout set aside as quiet in the last days — FYIs,
// answers to our questions, news on tasks that exist — readable in HQ → Today, not only in the digest.
import { ExternalLink } from 'lucide-react'
import type { HqSlackQuietItem } from '../../../../../shared/hq-slack-digest'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { formatShortTimeAgo } from '@/lib/short-time-ago'

export function HqTodayQuiet({
  items,
  now
}: {
  items: readonly HqSlackQuietItem[]
  now: number
}): React.JSX.Element {
  if (items.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        {translate('auto.hq.quiet.empty', 'Nothing went by quietly in the last three days.')}
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        {translate(
          'auto.hq.quiet.hint',
          'What the Slack scout read and set aside without a card: news, answers to what the chats asked, updates on tasks that exist.'
        )}
      </p>
      <ul className="flex flex-col gap-1">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-accent/50"
          >
            <div className="min-w-0 flex-1">
              <p className="text-[13px]">
                {item.author ? <span className="font-medium">{item.author}: </span> : null}
                {item.summary}
              </p>
              <p className="text-xs text-muted-foreground">
                {[item.channelName, item.why, formatShortTimeAgo(Date.parse(item.at), now)]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
            {item.permalink ? (
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                title={translate('auto.hq.quiet.open', 'Open in Slack')}
                aria-label={translate('auto.hq.quiet.open', 'Open in Slack')}
                onClick={() => void window.api.shell.openUrl(item.permalink ?? '')}
              >
                <ExternalLink />
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  )
}
