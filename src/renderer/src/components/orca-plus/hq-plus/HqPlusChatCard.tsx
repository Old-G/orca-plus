// Custom build (hq-plus-ui-v3): one chat's card in HQ+'s feed — a click opens its full reply and a reply
// box below. Custom build (hq-plus-ui-v4): it grows and folds smoothly, and the keys can select it.
import { useLayoutEffect, useRef, useState } from 'react'
import { NativeChatMarkdown } from '../../native-chat/NativeChatMarkdown'
import { useHqPlusLastReply } from './use-hq-plus-last-reply'
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible'
import { translate } from '@/i18n/i18n'
import type { HqPlusLogItem } from '../../../../../shared/hq-plus-log'
import type { HqPlusBadge } from '../../../../../shared/hq-plus-kinds'
import { HqPlusBadges } from './HqPlusBadge'
import { HqPlusText } from './HqPlusText'
import { HqPlusThreadComposer } from './HqPlusThreadComposer'
import { HqPlusCloseChat } from './HqPlusCloseChat'
import { HqPlusGrow } from './HqPlusGrow'
import { HqPlusChatName } from './HqPlusChatName'
import { hqPlusPinWhileMoving } from './hq-plus-scroll-pin'
import type { HqPlusLogContext } from './HqPlusLog'

export function hqPlusClock(at: number): string {
  return new Date(at).toTimeString().slice(0, 5)
}

const clock = hqPlusClock

// Custom build (hq-plus-ui-v3): a chat that has no live status any more has finished its turn.
const DONE: HqPlusBadge = { label: 'DONE', tone: 'done' }
const CARD_OWN_CLICKS =
  "button, a, textarea, input, .hqp-chatc-text[data-open='true'], .hqp-chatc-reply"

/** Custom build (hq-plus-ui-v3): one chat's card — a click opens its full reply and a reply box below. */
export function ChatCard({
  item,
  badges,
  tile,
  flash,
  openChat,
  ctx
}: {
  item: Extract<HqPlusLogItem, { kind: 'line' }>
  badges: readonly HqPlusBadge[]
  tile: React.ReactNode
  flash: boolean
  openChat: (() => void) | null
  ctx: HqPlusLogContext
}): React.JSX.Element {
  const open = ctx.isExpanded(item.id)
  // Custom build (hq-plus-ui-v5): opened, the card reads the whole latest reply from the chat itself.
  const fullReply = useHqPlusLastReply(item.sessionId, open, item.at)
  const status = ctx.chatStatus(item.sessionId) ?? DONE
  const cardKey = item.sessionId ?? item.address
  const closer = ctx.closeChat(item.sessionId, cardKey ? { key: cardKey, at: item.at } : undefined)
  const key = item.address ?? item.sessionId
  const canReply = Boolean(item.address || item.sessionId)
  return (
    <FeedRow item={item} ctx={ctx} tile={tile}>
      <div
        className="hqp-chatc"
        data-flash={flash ? 'true' : undefined}
        data-picked={ctx.isOpenChat(item.sessionId) ? 'true' : undefined}
        data-expandable="true"
        aria-expanded={open}
        // Why: the card itself folds open; its buttons, links and the reply box keep their own clicks.
        onClick={(event) => {
          const target = event.target
          if (!(target instanceof Element) || !target.closest(CARD_OWN_CLICKS)) {
            hqPlusPinWhileMoving(event.currentTarget, 8)
            ctx.setExpanded(item.id, !open)
          }
        }}
      >
        <div className="hqp-row-h">
          <HqPlusBadges badges={badges} />
          <NewMark item={item} ctx={ctx} />
          <strong>{item.project ?? 'HQ'}</strong>
          <HqPlusChatName chat={ctx.chatOf(item.sessionId)} />
          <span className="hqp-tm">{clock(item.at)}</span>
          <span className="hqp-spacer" />
          <HqPlusBadges badges={[status]} />
          {closer ? <HqPlusCloseChat closer={closer} name={item.project ?? 'chat'} /> : null}
        </div>
        <HqPlusGrow>
          {/* Custom build (hq-plus-ui-v4): one text, four lines with a fade when folded, all of it open. */}
          <ChatText text={item.body?.trim() || item.title} full={fullReply} open={open} />
        </HqPlusGrow>
        {item.earlier && item.earlier.length > 0 ? <ChatEarlier earlier={item.earlier} /> : null}
        {canReply ? (
          <Collapsible open={open}>
            <CollapsibleContent animation="height">
              <div className="hqp-chatc-reply">
                <HqPlusThreadComposer
                  target={{
                    address: item.address,
                    sessionId: item.sessionId,
                    replyTo: null,
                    about: null
                  }}
                  openQuestion={null}
                  label={item.address ?? item.project ?? 'chat'}
                  hqPath={ctx.hqPath}
                  onSent={ctx.onChanged}
                />
              </div>
            </CollapsibleContent>
          </Collapsible>
        ) : null}
        {item.address || openChat || open ? (
          <div className="hqp-row-f">
            {key && item.address ? (
              <button type="button" className="hqp-addr" onClick={() => ctx.onScope(key)}>
                {item.address}
              </button>
            ) : null}
            <span className="hqp-spacer" />
            {open ? (
              <button
                type="button"
                className="hqp-pill"
                onClick={() => ctx.setExpanded(item.id, false)}
              >
                {translate('auto.hqPlus.collapseCard', 'Collapse')}
              </button>
            ) : null}
            {openChat ? (
              <button type="button" className="hqp-pill" onClick={openChat}>
                {translate('auto.hqPlus.open', 'Open')}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </FeedRow>
  )
}

/** Folded: four lines, fading out only when there is more below. */
function ChatText({
  text,
  full,
  open
}: {
  text: string
  full: string | null
  open: boolean
}): React.JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  const [more, setMore] = useState(false)
  useLayoutEffect(() => {
    const element = box.current
    if (!element) {
      return
    }
    const measure = (): void => setMore(element.scrollHeight > element.clientHeight + 1)
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    measure()
    return () => observer.disconnect()
  }, [open, text])
  return (
    <div
      ref={box}
      className="hqp-chatc-text"
      data-open={open ? 'true' : undefined}
      data-more={more && !open ? 'true' : undefined}
    >
      {open ? (
        <NativeChatMarkdown className="hqp-md" content={full ?? text} />
      ) : (
        <HqPlusText text={text} />
      )}
    </div>
  )
}

/** Custom build (hq-plus-ui-v4): a feed row the keys can select; the click that lands in it selects it. */
export function FeedRow({
  item,
  ctx,
  tile,
  children
}: {
  item: HqPlusLogItem
  ctx: HqPlusLogContext
  tile: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div
      className="hqp-m"
      id={`hqp-${item.id}`}
      data-selected={ctx.selectedId === item.id ? 'true' : undefined}
      data-new={ctx.isNew(item.id) ? 'true' : undefined}
      onClickCapture={() => ctx.onSelect(item.id)}
    >
      {tile}
      {children}
    </div>
  )
}

export function NewMark({
  item,
  ctx
}: {
  item: HqPlusLogItem
  ctx: HqPlusLogContext
}): React.JSX.Element | null {
  return ctx.isNew(item.id) ? (
    <span className="hqp-new">{translate('auto.hqPlus.new', 'NEW')}</span>
  ) : null
}

/** Custom build (hq-plus-ui-v3): a chat's earlier turns, folded under its newest row. */
function ChatEarlier({
  earlier
}: {
  earlier: readonly { id: string; at: number; title: string }[]
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <div className="hqp-earlier">
      <button
        type="button"
        className="hqp-link"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {earlier.length === 1
          ? translate('auto.hqPlus.updateOne', '1 earlier update')
          : translate('auto.hqPlus.updates', '{{count}} earlier updates', {
              count: earlier.length
            })}
      </button>
      <Collapsible open={open}>
        <CollapsibleContent animation="height">
          <ul>
            {earlier.map((turn) => (
              <li key={turn.id}>
                <span className="hqp-tm">{clock(turn.at)}</span> <HqPlusText text={turn.title} />
              </li>
            ))}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}
