// Custom build (hq-plus-ui): one chat in HQ+'s Chats column — its project tile, state chip, title, age
// and one line of what it waits for; in «By work» the project's name opens that line and a chat that
// started others shows how many on its tile (hq-plus-work-view, owner 06.11).
import { translate } from '@/i18n/i18n'
import { formatRelativeTime } from '@/components/activity/activity-thread-presentation'
import type { HqChatItem } from '../hq/hq-chat-list'
import { useHqChatTitle } from '../hq/HqChatAvatar'
import { useHqPlusChatChip } from './use-hq-plus-chat-chip'
import { tileStyle } from './HqPlusSideProjects'
import { HqPlusCloseChat, type HqPlusChatCloser } from './HqPlusCloseChat'
import type { HqPlusOtherWait } from './HqPlusSideQueues'

export type HqPlusTile = { letters: string; color: string | null }

/**
 * Custom build (hq-plus-chat-waits): one line under the chat's name says what it waits for — the owner
 * (its question), a person (who and what), or nothing because it works or is done. The latest word
 * from it moved to the row's tooltip.
 */
function previewOf(item: HqChatItem, waitsOn: HqPlusOtherWait | null): string {
  const card = item.card
  if (item.group === 'needs') {
    return card?.askSummary ?? translate('auto.hq.chats.waitsForYou', 'Waiting for you')
  }
  if (waitsOn) {
    return translate('auto.hqPlus.side.waitsFor', 'Waits for {{who}} · {{what}}', {
      who: waitsOn.who ?? translate('auto.hqPlus.side.someone', 'someone'),
      what: waitsOn.title
    })
  }
  switch (item.group) {
    case 'working':
      return translate('auto.hqPlus.side.worksAlone', 'Working on its own')
    case 'done':
      return translate('auto.hqPlus.side.doneUnread', 'Finished — not read yet')
    case 'quiet':
      return translate('auto.hqPlus.side.nothing', 'Idle')
  }
}

function lastWordOf(item: HqChatItem): string | undefined {
  const card = item.card
  return card?.lastAgentMessage ?? card?.lastUserMessage ?? (card?.task || undefined)
}

export function HqPlusChatRow({
  item,
  picked,
  now,
  tile,
  closer,
  onPick,
  draft,
  waitsOn = null,
  depth,
  project,
  kids = 0
}: {
  item: HqChatItem
  picked: boolean
  now: number
  tile: HqPlusTile
  closer: HqPlusChatCloser | null
  onPick: (item: HqChatItem) => void
  /** Custom build (hq-plus-drafts): the owner's unsent words, shown instead of the chat's last line. */
  draft?: string
  /** Custom build (hq-plus-chat-waits): what we wait for from a person on this chat's behalf. */
  waitsOn?: HqPlusOtherWait | null
  /** Custom build (hq-plus-chat-tree): how deep under the chat that started it, in «By work». */
  depth?: number
  /** Custom build (hq-plus-chat-tree): the project's name, first on the second line, in «By work». */
  project?: string
  /** Custom build (hq-plus-work-view): the open chats this one started, in «By work». */
  kids?: number
}): React.JSX.Element {
  const title = useHqChatTitle(item)
  const { chip, waitingFor, live } = useHqPlusChatChip(item, now)
  const projectName = project ?? item.projectName
  const preview = draft
    ? `✎ ${draft.replace(/\s+/g, ' ').slice(0, 120)}`
    : waitingFor && !waitsOn
      ? `${waitingFor.charAt(0).toUpperCase()}${waitingFor.slice(1)}`
      : previewOf(item, waitsOn)
  return (
    <div
      className="hqp-qi-row"
      data-live={live ? 'true' : undefined}
      data-child={depth ? 'true' : undefined}
      style={depth ? ({ '--hqp-depth': depth } as React.CSSProperties) : undefined}
    >
      <button
        type="button"
        className="hqp-pc"
        title={lastWordOf(item)?.replace(/\s+/g, ' ').slice(0, 300)}
        aria-current={picked ? 'true' : undefined}
        data-read={chip ? undefined : 'true'}
        onClick={() => onPick(item)}
      >
        <span
          className="hqp-tile"
          style={tileStyle(tile.color)}
          title={
            kids > 0
              ? translate('auto.hqPlus.side.tileKids', '{{project}} · started {{count}} chats', {
                  project: projectName,
                  count: kids
                })
              : projectName
          }
          aria-hidden="true"
        >
          {tile.letters}
          {/* Custom build (hq-plus-work-view): how many chats this one started, on its tile's corner so the
              narrow column keeps room for the title. */}
          {kids > 0 ? <span className="hqp-tile-kids">{kids}</span> : null}
        </span>
        <span className="t">
          {chip ? (
            <span className="hqp-badge" data-tone={chip.tone}>
              {chip.label}
            </span>
          ) : null}
          <span className="hqp-pc-tt">{title}</span>
        </span>
        <span className="w">{item.sortAt ? formatRelativeTime(item.sortAt, now) : ''}</span>
        <span className="s">
          {project ? (
            <>
              <span
                className="hqp-pc-proj"
                style={tile.color ? { color: tile.color } : undefined}
                title={project}
              >
                {project}
              </span>
              <span className="hqp-pc-dot" aria-hidden="true">
                ·
              </span>
            </>
          ) : null}
          <span className="hqp-pc-sl">{preview}</span>
        </span>
      </button>
      {closer ? <HqPlusCloseChat closer={closer} name={title} /> : null}
    </div>
  )
}
