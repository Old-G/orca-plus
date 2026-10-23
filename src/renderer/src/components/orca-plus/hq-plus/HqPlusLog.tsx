// Custom build (hq-plus-ui): the conversation with HQ — oldest at the top, newest at the bottom, and it
// follows the bottom unless the owner scrolled up to read; then a «↓ new: N» button brings it back.
import { useLayoutEffect, useRef, useState } from 'react'
import { hqPlusNotNowKey, type HqPlusLogItem } from '../../../../../shared/hq-plus-log'
import { translate } from '@/i18n/i18n'
import { HqPlusCardView } from './HqPlusCard'

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

function tileOf(project: string | null): string {
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
  if (item.kind === 'line' && item.tone === 'system') {
    return (
      <div className="hqp-sys" id={`hqp-${item.id}`}>
        <i aria-hidden="true" />
        <span>
          {item.title} <span className="hqp-tm">{clock(item.at)}</span>
        </span>
      </div>
    )
  }
  const key = hqPlusThreadKey(item)
  const color = ctx.roomColor(item.room)
  // Why: a chat's line opens that chat on the right, to read on and write into it from HQ+.
  const openLine = item.kind === 'line' ? ctx.openChat(item.sessionId) : null
  return (
    <div className="hqp-m" id={`hqp-${item.id}`}>
      <span className="hqp-tile" style={color ? roomStyle(color) : undefined} aria-hidden="true">
        {tileOf(item.project)}
      </span>
      <div className="b">
        {item.kind === 'line' && item.tone === 'person' ? (
          <span className="hqp-tg" data-tone="person">
            {translate('auto.hqPlus.tag.person', 'person')}
          </span>
        ) : null}
        <strong>{item.project ?? 'HQ'}:</strong> {item.kind === 'line' ? item.title : null}
        {item.kind === 'card' && item.type !== 'move' ? item.title : null}
        <span className="hqp-tm">{clock(item.at)}</span>
        {key ? (
          <button type="button" className="hqp-addr" onClick={() => ctx.onScope(key)}>
            {item.address ?? translate('auto.hqPlus.thread', 'thread')}
          </button>
        ) : null}
        {openLine ? (
          <button type="button" className="hqp-addr" onClick={openLine}>
            {translate('auto.hqPlus.open', 'Open')}
          </button>
        ) : null}
        {item.kind === 'card' ? (
          <HqPlusCardView
            card={item}
            flash={flash}
            hqPath={ctx.hqPath}
            hqWorktreeId={ctx.hqWorktreeId}
            onOpenChat={ctx.openChat(item.sessionId)}
            onOpenReport={ctx.onOpenReport}
            onNotNow={item.open ? () => ctx.onNotNow(hqPlusNotNowKey(item)) : null}
            onChanged={ctx.onChanged}
          />
        ) : null}
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
