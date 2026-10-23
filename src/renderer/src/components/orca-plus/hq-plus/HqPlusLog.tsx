// Custom build (hq-plus-ui): the conversation with HQ — oldest at the top, newest at the bottom, and it
// follows the bottom unless the owner scrolled up to read; then a «↓ new: N» button brings it back.
import { useLayoutEffect, useRef, useState } from 'react'
import { hqPlusNotNowKey, type HqPlusLogItem } from '../../../../../shared/hq-plus-log'
import { hqPlusLook, type HqPlusBadge } from '../../../../../shared/hq-plus-kinds'
import { translate } from '@/i18n/i18n'
import { runPulseBellAction } from '../pulse-bell/pulse-bell-actions'
import { HqPlusCardView } from './HqPlusCard'
import { HqPlusBadges } from './HqPlusBadge'
import { HqPlusText } from './HqPlusText'

const BOTTOM_SLACK_PX = 40

export type HqPlusLogContext = {
  hqPath: string | null
  hqWorktreeId: string | null
  roomColor: (room: string) => string | null
  openChat: (sessionId: string | null) => (() => void) | null
  onScope: (key: string) => void
  onOpenReport: (path: string) => void
  onNotNow: (id: string) => void
  onChanged: () => void
  /** Custom build (hq-plus-ui-v2): the live chat's state badge (working, waits on someone, done). */
  chatStatus: (sessionId: string | null) => HqPlusBadge | null
  /** The project's own colour, the same as in the chat list; null leaves the room's. */
  projectColor: (project: string | null) => string | null
}

export function hqPlusThreadKey(item: {
  address: string | null
  sessionId: string | null
}): string | null {
  return item.address ?? item.sessionId
}

function clock(at: number): string {
  return new Date(at).toTimeString().slice(0, 5)
}

function roomStyle(color: string): React.CSSProperties & Record<'--hqp-room', string> {
  return { '--hqp-room': color }
}

export function hqPlusTileOf(project: string | null): string {
  if (!project) {
    return 'HQ'
  }
  const parts = project.split(/[-_\s]+/).filter(Boolean)
  const letters =
    parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : (parts[0] ?? project).slice(0, 2)
  return letters.toUpperCase()
}

function LogItem({
  item,
  flash,
  ctx
}: {
  item: HqPlusLogItem
  flash: boolean
  ctx: HqPlusLogContext
}): React.JSX.Element {
  if (item.kind === 'me') {
    return (
      <div className="hqp-me" id={`hqp-${item.id}`}>
        {item.text}
        <span className="hqp-tm">{clock(item.at)}</span>
      </div>
    )
  }
  const look = hqPlusLook(item)
  const key = hqPlusThreadKey(item)
  const color = ctx.projectColor(item.project) ?? ctx.roomColor(item.room)
  const tile = (
    <span className="hqp-tile" style={color ? roomStyle(color) : undefined} aria-hidden="true">
      {hqPlusTileOf(item.project)}
    </span>
  )
  if (look.kind === 'bg') {
    const card = item.kind === 'card' ? item : null
    const bell = card?.open ? card.inbox : null
    const action = bell?.actions[0] ?? null
    return (
      <div className="hqp-bgl" id={`hqp-${item.id}`} data-flash={flash ? 'true' : undefined}>
        <span className="hqp-tm">{clock(item.at)}</span>
        <HqPlusBadges badges={look.badges} />
        <span className="hqp-bgl-t">
          {item.project ? <span className="hqp-bgl-p">{item.project} · </span> : null}
          <HqPlusText text={item.title} maxLines={1} />
        </span>
        {bell && action ? (
          <button
            type="button"
            className="hqp-link"
            onClick={() =>
              void runPulseBellAction(bell, action.id).then(() => ctx.onChanged())
            }
          >
            {action.label}
          </button>
        ) : null}
        {card?.open && card.inbox ? (
          <button
            type="button"
            className="hqp-link"
            data-ghost="true"
            onClick={() => ctx.onNotNow(hqPlusNotNowKey(card))}
          >
            {translate('auto.hqPlus.notNow', 'Not now')}
          </button>
        ) : null}
      </div>
    )
  }
  // Why: a chat's row opens that chat on the right, to read on and write into it from HQ+.
  const openChat = ctx.openChat(item.sessionId)
  if (look.kind === 'chat' && item.kind === 'line') {
    const status = ctx.chatStatus(item.sessionId)
    return (
      <div className="hqp-m" id={`hqp-${item.id}`}>
        {tile}
        <div className="hqp-chatc" data-flash={flash ? 'true' : undefined}>
          <div className="hqp-row-h">
            <HqPlusBadges badges={look.badges} />
            <strong>{item.project ?? 'HQ'}</strong>
            <span className="hqp-tm">{clock(item.at)}</span>
            <span className="hqp-spacer" />
            {status ? <HqPlusBadges badges={[status]} /> : null}
          </div>
          <HqPlusText text={item.title} maxLines={3} />
          {key || openChat ? (
            <div className="hqp-row-f">
              {key ? (
                <button type="button" className="hqp-addr" onClick={() => ctx.onScope(key)}>
                  {item.address ?? translate('auto.hqPlus.thread', 'thread')}
                </button>
              ) : null}
              <span className="hqp-spacer" />
              {openChat ? (
                <button type="button" className="hqp-pill" onClick={openChat}>
                  {translate('auto.hqPlus.open', 'Open')}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    )
  }
  if (item.kind !== 'card') {
    return (
      <div className="hqp-m" id={`hqp-${item.id}`}>
        {tile}
        <div className="b">
          <HqPlusBadges badges={look.badges} />
          <strong>{item.project ?? 'HQ'}:</strong> <HqPlusText text={item.title} maxLines={3} />
          <span className="hqp-tm">{clock(item.at)}</span>
        </div>
      </div>
    )
  }
  return (
    <div className="hqp-m" id={`hqp-${item.id}`}>
      {tile}
      <div className="b">
        <HqPlusCardView
          card={item}
          look={look}
          flash={flash}
          hqPath={ctx.hqPath}
          hqWorktreeId={ctx.hqWorktreeId}
          when={clock(item.at)}
          threadLabel={key ? (item.address ?? translate('auto.hqPlus.thread', 'thread')) : null}
          onThread={key ? () => ctx.onScope(key) : null}
          onOpenChat={openChat}
          onOpenReport={ctx.onOpenReport}
          onNotNow={item.open ? () => ctx.onNotNow(hqPlusNotNowKey(item)) : null}
          onChanged={ctx.onChanged}
        />
      </div>
    </div>
  )
}

export function HqPlusLog({
  items,
  flashId,
  ctx
}: {
  items: HqPlusLogItem[]
  flashId: string | null
  ctx: HqPlusLogContext
}): React.JSX.Element {
  const log = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const seen = useRef(items.length)
  const [unseen, setUnseen] = useState(0)

  // Why: only a grown log moves the view; a re-render of the same rows must not.
  useLayoutEffect(() => {
    const element = log.current
    const added = items.length - seen.current
    seen.current = items.length
    if (!element || added <= 0) {
      return
    }
    if (atBottom.current) {
      element.scrollTop = element.scrollHeight
    } else {
      setUnseen((count) => count + added)
    }
  }, [items.length])

  const toBottom = (): void => {
    const element = log.current
    if (element) {
      element.scrollTop = element.scrollHeight
    }
    atBottom.current = true
    setUnseen(0)
  }

  useLayoutEffect(() => {
    const element = log.current
    if (element) {
      element.scrollTop = element.scrollHeight
    }
  }, [])

  return (
    <>
      <div
        className="hqp-log"
        ref={log}
        onScroll={(event) => {
          const element = event.currentTarget
          const bottom =
            element.scrollHeight - element.scrollTop - element.clientHeight < BOTTOM_SLACK_PX
          atBottom.current = bottom
          if (bottom) {
            setUnseen(0)
          }
        }}
      >
        {items.length === 0 ? (
          <p className="hqp-empty">
            {translate('auto.hqPlus.log.empty', 'Nothing in this room this week yet.')}
          </p>
        ) : null}
        {items.map((item) => (
          <LogItem key={item.id} item={item} flash={item.id === flashId} ctx={ctx} />
        ))}
        <div className="hqp-live">
          <i aria-hidden="true" />
          {translate('auto.hqPlus.log.live', 'agents are working — new rows appear below')}
        </div>
      </div>
      {unseen > 0 ? (
        <button type="button" className="hqp-jump" onClick={toBottom}>
          ↓ {translate('auto.hqPlus.log.unseen', 'new: {{count}}', { count: unseen })}
        </button>
      ) : null}
    </>
  )
}
