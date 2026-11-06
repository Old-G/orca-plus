// Custom build (hq-ledger-feed): one conversation in HQ+'s feed — a Slack thread, ClickUp task or MR —
// with what the owner asked and what people answered, its project as a chip the owner can fix (the
// thread keeps it, a channel's new threads take it), and the buttons of every card folded into it.
// Custom build (hq-plus-card-shell): drawn in the cards' one shell.
import { useState } from 'react'
import { translate } from '@/i18n/i18n'
import type { HqPlusCard } from '../../../../../shared/hq-plus-log'
import type { PulseInboxItem } from '../../../../../shared/pulse-types'
import type { HqFeedMessage } from '../../../../../shared/hq-feed-ledger'
import { hqPlusLook, type HqPlusLook } from '../../../../../shared/hq-plus-kinds'
import { HQ_INTAKE_KIND } from '../../../../../shared/hq-slack-intake'
import { HQ_REMIND_KIND } from '../../../../../shared/hq-remind'
import {
  HQ_WAITING_REPLY_KIND,
  readHqWaitingReplyRef
} from '../../../../../shared/hq-waiting-reply-bell'
import { hqPlusLedgerOnly } from '../../../../../shared/hq-plus-ledger-cards'
import { HqPlusText } from './HqPlusText'
import { HqPlusBrainNames } from './HqPlusBrainLink'
import { HqPlusCardView, hqPlusDoneLabel } from './HqPlusCard'
import {
  HqPlusCardButtons,
  HqPlusCardFold,
  HqPlusCardHead,
  HqPlusCardShell,
  HqPlusCardSource,
  useHqPlusRun,
  type HqPlusCardButton
} from './HqPlusCardShell'
import { hqPlusCall } from './use-hq-plus-data'
import { hqPlusClock as clock } from './HqPlusChatCard'
import type { HqPlusLogContext } from './HqPlusLog'
import { noteHqPlusTakeHint } from './hq-plus-take-hint'
import { HqPlusInWorkButtons } from './HqPlusInWorkButtons'
import { closeEarlierRequests } from './hq-plus-earlier-requests'

const SHOWN_MESSAGES = 3

/** «DM», «thread», «DEV-18434», «!314» — where the talk is, beside who is in it. */
function placeLabel(key: string): string {
  const [source, place = '', thread = ''] = key.split(':')
  if (source === 'slack') {
    return place.startsWith('D') ? 'DM' : thread ? 'thread' : 'channel'
  }
  if (source === 'gitlab') {
    return `!${key.split('!').at(-1) ?? ''}`
  }
  return place
}

function people(messages: readonly HqFeedMessage[]): string {
  const names = [
    ...new Set(messages.flatMap((m) => (m.direction === 'in' && m.author ? [m.author] : [])))
  ]
  return names.slice(0, 3).join(', ')
}

/** What a folded card is, in a few words, before its buttons. */
function partLabel(part: HqPlusCard): string | null {
  const kind = part.inbox?.kind
  if (kind === HQ_WAITING_REPLY_KIND) {
    const author = readHqWaitingReplyRef(part.inbox?.refId ?? null)?.author ?? ''
    return translate('auto.hqPlus.conv.answer', '{{author}} answered your question', { author })
  }
  if (kind === HQ_REMIND_KIND) {
    return part.title.split(':')[0] ?? part.title
  }
  if (kind === HQ_INTAKE_KIND) {
    return translate('auto.hqPlus.conv.forYou', 'Waits on you')
  }
  // Why: a request's own title is the conversation's gist, already above.
  return null
}

function Message({ message }: { message: HqFeedMessage }): React.JSX.Element {
  const out = message.direction === 'out'
  const who = out
    ? translate('auto.hqPlus.conv.you', 'You')
    : (message.author ?? translate('auto.hqPlus.conv.someone', 'Someone'))
  const said = message.text.startsWith(`${who}:`)
    ? message.text.slice(who.length + 1).trim()
    : message.text
  return (
    <div className="hqp-msg" data-out={out ? 'true' : undefined}>
      {/* Custom build (hq-plus-map): the name in its own colour, the time quiet beside it. */}
      <span className="who">
        <b>{who}</b>
        <time>{clock(message.at)}</time>
      </span>
      <HqPlusText text={said} maxLines={out ? 2 : 4} />
    </div>
  )
}

/** The project chip: dashed while the small model's guess stands; a click picks another. */
export function HqPlusProjectChip({
  card,
  onChanged
}: {
  card: HqPlusCard
  onChanged: () => void
}): React.JSX.Element {
  const conversation = card.conversation
  const [slugs, setSlugs] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const label = card.project ?? translate('auto.hqPlus.conv.noProject', 'No project')
  if (!conversation) {
    return <span className="hqp-projchip">{label}</span>
  }
  if (slugs) {
    return (
      <span className="hqp-proj-pick">
        <select
          className="hqp-projchip"
          autoFocus
          defaultValue={card.project ?? ''}
          aria-label={translate('auto.hqPlus.conv.pickProject', 'Project of this conversation')}
          onBlur={() => setSlugs(null)}
          onChange={(event) => {
            const project = event.target.value
            if (!project) {
              return
            }
            void hqPlusCall('hq.conversationProject', { key: conversation.key, project }).then(
              (result) => {
                if (result.ok) {
                  setSlugs(null)
                  onChanged()
                } else {
                  setError(result.message)
                }
              }
            )
          }}
        >
          <option value="" disabled>
            {translate('auto.hqPlus.conv.pickProject', 'Project of this conversation')}
          </option>
          {slugs.map((slug) => (
            <option key={slug} value={slug}>
              {slug}
            </option>
          ))}
        </select>
        {error ? <span className="hqp-error">{error}</span> : null}
      </span>
    )
  }
  return (
    <button
      type="button"
      className="hqp-projchip"
      data-guess={conversation.guessed || !card.project ? 'true' : undefined}
      title={
        conversation.guessed
          ? translate(
              'auto.hqPlus.conv.guessHint',
              'Guessed by the model. Pick the right project: this thread keeps it, and in a channel its new threads take it'
            )
          : translate(
              'auto.hqPlus.conv.projectHint',
              'Pick another project: this thread keeps it, and in a channel its new threads take it'
            )
      }
      onClick={() =>
        void window.api.hqProjects.list().then((pages) => {
          setSlugs(pages.ok ? pages.pages.map((page) => page.slug).sort() : [])
        })
      }
    >
      {label} ▾
    </button>
  )
}

/** Custom build (hq-ledger-sources): an MR or a mail thread no other card stands for — open it where
 *  it lives, or say it is done (the next message brings it back). */
function LedgerOnlyButtons({
  card,
  link,
  ctx
}: {
  card: HqPlusCard
  link: string | null
  ctx: HqPlusLogContext
}): React.JSX.Element {
  const { busy, pending, error, run } = useHqPlusRun(ctx.onChanged)
  const key = card.conversation?.key ?? ''
  const yours = card.conversation?.ledgerState === 'you'
  // Custom build (hq-ledger-cutover, owner 03.11): a Slack talk goes to a project or chat from its
  // card, also when no reader raised a «To work» card for it.
  const slack = key.startsWith('slack:')
  const buttons: HqPlusCardButton[] = [
    ...(slack
      ? [
          {
            id: 'to-work',
            label: translate('auto.hqPlus.conv.toWork', 'To work'),
            hint: translate(
              'auto.hqPlus.conv.toWorkHint',
              'Pick a project and a chat; the chat gets the whole thread'
            ),
            main: true,
            disabled: busy,
            pending: pending === 'to-work',
            onClick: () =>
              run(async () => {
                const taken = await hqPlusCall('hq.conversationToWork', { key })
                const item = taken.ok
                  ? (Reflect.get(Object(taken.result), 'item') as PulseInboxItem)
                  : null
                if (!taken.ok || !item) {
                  return taken.ok ? { ok: false as const, message: 'No card to take' } : taken
                }
                const proposed = card.conversation?.guess?.chat
                noteHqPlusTakeHint(item.id, {
                  project: card.project,
                  sessionId: card.sessionId ?? (proposed && proposed !== 'new' ? proposed : null),
                  key,
                  guess: card.conversation?.guess ?? null
                })
                ctx.toWork(item)
                return { ok: true as const }
              }, 'to-work')
          }
        ]
      : []),
    ...(link
      ? [
          {
            id: 'open',
            label: translate('auto.hqPlus.conv.open', 'Open ↗'),
            main: yours && !slack,
            ghost: !yours || slack,
            onClick: (event: React.MouseEvent<HTMLButtonElement>) => ctx.openLink(link, event)
          }
        ]
      : []),
    {
      id: 'done',
      label: translate('auto.hqPlus.conv.done', 'Done'),
      hint: translate(
        'auto.hqPlus.conv.doneHint',
        'Nothing more to do here. A new message brings it back'
      ),
      ghost: true,
      disabled: busy,
      pending: pending === 'done',
      onClick: () =>
        run(
          () =>
            hqPlusCall('hq.conversationDone', { key }).then((result) =>
              result.ok ? { ok: true as const } : result
            ),
          'done'
        )
    }
  ]
  return (
    <>
      <HqPlusCardButtons buttons={buttons} />
      {error ? <p className="hqp-error">{error}</p> : null}
    </>
  )
}

export function HqPlusConversationCard({
  card,
  look,
  flash,
  openChat,
  ctx
}: {
  card: HqPlusCard
  look: HqPlusLook
  flash: boolean
  openChat: (() => void) | null
  ctx: HqPlusLogContext
}): React.JSX.Element | null {
  const conversation = card.conversation
  const expanded = ctx.isExpanded(card.id)
  if (!conversation) {
    return null
  }
  const messages = conversation.messages
  const shown = expanded ? messages : messages.slice(-SHOWN_MESSAGES)
  const hidden = messages.length - shown.length
  const chat = ctx.chatOf(card.sessionId)
  const link = conversation.link?.startsWith('https://') ? conversation.link : null
  const who = people(messages)
  const head = (
    <HqPlusCardHead
      badges={look.badges}
      lead={
        <>
          {/* Custom build (hq-plus-brain): each name opens Brain on that person. */}
          {who ? <HqPlusBrainNames names={who.split(', ')} /> : null}
          <span className="hqp-note">{placeLabel(conversation.key)}</span>
          <HqPlusProjectChip card={card} onChanged={ctx.onChanged} />
        </>
      }
      chat={chat}
      onOpenChat={chat && (chat.item || chat.name) ? openChat : null}
      when={clock(card.at)}
      right={link ? <HqPlusCardSource url={link} onOpen={ctx.openLink} /> : null}
    />
  )
  const kind = {
    className: 'hqp-card hqp-conv',
    'data-look': look.kind,
    'data-source': look.source ?? undefined,
    'data-flash': flash ? 'true' : undefined
  }
  const inWork = conversation.inWork && conversation.id ? conversation.id : null
  const done = inWork
    ? translate('auto.hqPlus.conv.inWork', 'In work in «{{chat}}»', {
        chat: chat?.name ?? translate('auto.hqPlus.conv.aChat', 'a chat')
      })
    : card.done
      ? hqPlusDoneLabel(card.done)
      : null
  // Why: a settled conversation folds to two lines, as every decided card does; a click opens it.
  if (!card.open && !expanded) {
    return (
      <HqPlusCardShell
        {...kind}
        head={head}
        folded={
          <HqPlusCardFold
            line={conversation.title}
            done={done}
            onOpen={() => ctx.setExpanded(card.id, true)}
          />
        }
      />
    )
  }
  return (
    <HqPlusCardShell
      {...kind}
      data-open={card.open ? 'true' : undefined}
      head={head}
      done={done}
      footer={{ onCollapse: expanded ? () => ctx.setExpanded(card.id, false) : null }}
    >
      <p className="hqp-conv-t">
        <HqPlusText text={conversation.title} maxLines={2} />
      </p>
      {hidden > 0 ? (
        <button
          type="button"
          className="hqp-said-more"
          onClick={() => ctx.setExpanded(card.id, true)}
        >
          {translate('auto.hqPlus.conv.earlier', '{{count}} earlier', { count: hidden })}
        </button>
      ) : null}
      <div className="hqp-msgs">
        {shown.map((message) => (
          <Message key={`${message.at}:${message.direction}`} message={message} />
        ))}
      </div>
      {card.open && hqPlusLedgerOnly(card) ? (
        <LedgerOnlyButtons card={card} link={link} ctx={ctx} />
      ) : null}
      {inWork ? (
        <HqPlusInWorkButtons
          conversationId={inWork}
          openChat={chat && (chat.item || chat.name) ? openChat : null}
          ctx={ctx}
        />
      ) : null}
      {conversation.parts.map((part) => (
        <div key={part.id} className="hqp-part">
          {partLabel(part) ? (
            <span className="hqp-part-l">
              <HqPlusText text={partLabel(part) ?? ''} maxLines={1} />
            </span>
          ) : null}
          <HqPlusCardView
            bare
            card={part}
            look={hqPlusLook(part)}
            flash={false}
            hqPath={ctx.hqPath}
            hqWorktreeId={ctx.hqWorktreeId}
            when={clock(part.at)}
            threadLabel={null}
            onThread={null}
            chat={ctx.chatOf(part.sessionId)}
            onOpenChat={ctx.openChat(part.sessionId)}
            onOpenLink={ctx.openLink}
            onOpenReport={ctx.onOpenReport}
            onNotNow={() => ctx.onNotNow(card.id)}
            onChanged={() => {
              // Why: deciding the newest request decides the talk; its earlier messages ask nothing more.
              void closeEarlierRequests(conversation.earlierRequests).then(ctx.onChanged)
            }}
            expanded={false}
            onExpand={() => {}}
            onToWork={(inbox) => {
              void closeEarlierRequests(conversation.earlierRequests)
              // Why: the conversation's project and chat are what its card shows; a folded part may know neither.
              noteHqPlusTakeHint(inbox.id, { project: part.project, sessionId: part.sessionId })
              // Custom build (hq-intake-decide): a chat the model proposed, when none holds it yet.
              const proposed = card.conversation?.guess?.chat
              noteHqPlusTakeHint(inbox.id, {
                project: card.project,
                sessionId: card.sessionId ?? (proposed && proposed !== 'new' ? proposed : null),
                key: card.conversation?.key ?? null,
                guess: card.conversation?.guess ?? null
              })
              ctx.toWork(inbox)
            }}
          />
        </div>
      ))}
    </HqPlusCardShell>
  )
}
