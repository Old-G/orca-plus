// Custom build (hq-plus-phone): one decision in HQ+'s phone feed — the agent's question, a person's
// answer, a held message (read only: Approve stays on the Mac), a wait on the owner, a new report or
// a request that came in. Open while it waits; once decided it folds to two lines and opens on a tap.
import { useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import type { HqPlusCard } from '../../../src/shared/hq-plus-log'
import { hqPlusLook } from '../../../src/shared/hq-plus-kinds'
import type { HqPlusPhoneResult } from './hq-plus-phone-actions'
import {
  closeHqPlusPhoneWait,
  markHqPlusPhoneDone,
  replyOnHqPlusPhoneCard,
  runHqPlusPhoneBellAction
} from './hq-plus-phone-actions'
import { hqp, hqpStyles } from './hq-plus-phone-theme'
import {
  HQP_OPEN_CHAT_ACTIONS,
  hqpChoices,
  hqpDoneLabel,
  hqpInboxActions,
  hqpNoteOf,
  hqpQuestionOf,
  hqpReportPath,
  hqpSourceLink
} from './mobile-hq-plus-card-model'
import type { HqpFeedContext } from './mobile-hq-plus-feed-context'
import {
  HqpBadge,
  HqpButton,
  HqpButtons,
  HqpCardFrame,
  HqpHead,
  clock,
  hqpCardStyles as s
} from './mobile-hq-plus-parts'

export function MobileHqPlusCard({
  card,
  flash,
  ctx
}: {
  card: HqPlusCard
  flash: boolean
  ctx: HqpFeedContext
}) {
  const look = hqPlusLook(card)
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [text, setText] = useState('')
  const chat = ctx.chatOf(card.sessionId)
  const report = card.type === 'report' ? hqpReportPath(card) : null
  const source = hqpSourceLink(card)
  const note = hqpNoteOf(card, report?.folder ?? null)
  const client = ctx.client

  const run = (key: string, action: () => Promise<HqPlusPhoneResult>): void => {
    if (busy) {
      return
    }
    setBusy(key)
    setError(null)
    void action()
      .then((result) => {
        if (result.ok) {
          setText('')
          setExpanded(false)
          ctx.onChanged()
        } else {
          setError(result.message)
        }
      })
      .finally(() => setBusy(null))
  }

  const head = (
    <HqpHead>
      {look.badges.map((badge) => (
        <HqpBadge key={badge.label} badge={badge} />
      ))}
      {note ? <Text style={styles.note}>{note}</Text> : null}
      <Text style={s.project}>{card.project ?? 'HQ'}</Text>
      <Text style={s.time}>{clock(card.at)}</Text>
    </HqpHead>
  )
  const chatName = chat ? (
    <Text style={s.chatName} numberOfLines={1}>
      {chat.title}
    </Text>
  ) : null
  const frame = (children: React.ReactNode) => (
    <HqpCardFrame
      look={look.kind}
      approve={card.type === 'approve' && card.open}
      flash={flash}
      project={card.project}
      color={ctx.colorOf(card.project)}
    >
      {children}
    </HqpCardFrame>
  )

  if (!card.open && !expanded) {
    return frame(
      <Pressable accessibilityRole="button" onPress={() => setExpanded(true)} style={styles.fold}>
        {head}
        <Text style={s.text} numberOfLines={1}>
          {card.type === 'move' ? hqpQuestionOf(card) : card.title}
        </Text>
        {card.done ? <Text style={s.done}>✓ {hqpDoneLabel(card.done)}</Text> : null}
      </Pressable>
    )
  }

  const sourceLink = source ? (
    <View style={s.foot}>
      <View style={s.spacer} />
      <Pressable accessibilityRole="link" onPress={() => ctx.openLink(source.url)}>
        <Text style={hqpStyles.link}>{source.label}</Text>
      </Pressable>
    </View>
  ) : null
  const openChat = chat ? () => ctx.openChat(chat) : null
  const reply = (value: string): void =>
    run('reply', () =>
      client ? replyOnHqPlusPhoneCard(client, card, value, ctx.hqPath) : Promise.resolve(NO_MAC)
    )

  return frame(
    <>
      {head}
      {chatName}
      {card.type === 'approve' ? (
        <>
          <Text style={hqpStyles.hint}>{card.title.replace(/^Approve:\s*/, '')}</Text>
          {card.body ? <Text style={s.said}>{card.body}</Text> : null}
          {card.open ? (
            <View style={styles.onMac}>
              <Text style={styles.onMacLabel}>Approve on Mac</Text>
              <Text style={hqpStyles.hint}>
                Approve, edit or reject this message in Orca+ on the Mac.
              </Text>
            </View>
          ) : null}
        </>
      ) : card.type === 'report' ? (
        <Text style={s.text} numberOfLines={4}>
          {card.body ?? card.title}
        </Text>
      ) : (
        <>
          <Text style={s.question}>{hqpQuestionOf(card)}</Text>
          {card.report?.done ? <Text style={s.text}>Done: {card.report.done}</Text> : null}
          {card.report?.next ? <Text style={s.text}>Next: {card.report.next}</Text> : null}
          {!card.report && card.body && card.body !== hqpQuestionOf(card) ? (
            <Text style={card.type === 'reply' ? s.said : s.text} numberOfLines={8}>
              {card.body}
            </Text>
          ) : null}
        </>
      )}
      {card.done ? <Text style={s.done}>✓ {hqpDoneLabel(card.done)}</Text> : null}
      {card.open ? (
        <Buttons card={card} ctx={ctx} busy={busy} run={run} reply={reply} openChat={openChat} />
      ) : null}
      {card.open && card.type === 'report' && report ? (
        <HqpButtons>
          <HqpButton label="Open report" main onPress={() => ctx.openReport(report.path)} />
        </HqpButtons>
      ) : null}
      {card.open && card.type === 'move' && card.address ? (
        <View style={styles.replyRow}>
          <TextInput
            value={text}
            onChangeText={setText}
            editable={busy === null}
            placeholder="Answer this chat…"
            placeholderTextColor={hqp.faint}
            accessibilityLabel="Answer this chat"
            multiline
            style={styles.replyInput}
          />
          <HqpButton
            label={busy === 'reply' ? 'Sending…' : 'Send'}
            main
            disabled={busy !== null || !text.trim()}
            onPress={() => reply(text)}
          />
        </View>
      ) : null}
      {error ? <Text style={hqpStyles.error}>{error}</Text> : null}
      {sourceLink}
      {expanded ? (
        <Pressable accessibilityRole="button" onPress={() => setExpanded(false)}>
          <Text style={[hqpStyles.link, styles.collapse]}>Collapse</Text>
        </Pressable>
      ) : null}
    </>
  )
}

const NO_MAC: HqPlusPhoneResult = { ok: false, message: 'Not connected to the Mac.' }

function Buttons({
  card,
  ctx,
  busy,
  run,
  reply,
  openChat
}: {
  card: HqPlusCard
  ctx: HqpFeedContext
  busy: string | null
  run: (key: string, action: () => Promise<HqPlusPhoneResult>) => void
  reply: (value: string) => void
  openChat: (() => void) | null
}) {
  const client = ctx.client
  const withClient =
    (action: (rpc: NonNullable<typeof client>) => Promise<HqPlusPhoneResult>) =>
    (): Promise<HqPlusPhoneResult> =>
      client ? action(client) : Promise.resolve(NO_MAC)
  if (card.type === 'move') {
    return (
      <HqpButtons>
        {hqpChoices(card).map((choice, index) => (
          <HqpButton
            key={choice}
            label={choice}
            main={index === 0}
            disabled={busy !== null || !card.address}
            onPress={() => reply(choice)}
          />
        ))}
        {openChat ? <HqpButton label="Open chat" onPress={openChat} /> : null}
        {card.inbox ? (
          <HqpButton
            label="Got it"
            ghost
            disabled={busy !== null}
            onPress={() =>
              run(
                'seen',
                withClient((rpc) => markHqPlusPhoneDone(rpc, card, 'seen'))
              )
            }
          />
        ) : null}
      </HqpButtons>
    )
  }
  if (card.type === 'wait') {
    return (
      <HqpButtons>
        <HqpButton
          label="Done"
          main
          disabled={busy !== null}
          onPress={() =>
            run(
              'done',
              withClient((rpc) => closeHqPlusPhoneWait(rpc, card, 'resolved'))
            )
          }
        />
        <HqpButton
          label="Not needed"
          ghost
          disabled={busy !== null}
          onPress={() =>
            run(
              'drop',
              withClient((rpc) => closeHqPlusPhoneWait(rpc, card, 'cancelled'))
            )
          }
        />
      </HqpButtons>
    )
  }
  if (card.type === 'report') {
    return null
  }
  if (!card.inbox || card.type === 'approve') {
    return null
  }
  const look = hqPlusLook(card)
  const actions = hqpInboxActions(card, look)
  const hints = actions.flatMap((action) => (action.hint ? [action.hint] : []))
  return (
    <>
      <HqpButtons>
        {actions.map((action, index) => (
          <HqpButton
            key={action.id}
            label={busy === action.id ? 'Working…' : action.label}
            main={index === 0}
            ghost={action.ghost}
            disabled={busy !== null}
            onPress={() =>
              HQP_OPEN_CHAT_ACTIONS.has(action.id) && openChat
                ? openChat()
                : run(
                    action.id,
                    withClient((rpc) => runHqPlusPhoneBellAction(rpc, card, action.id))
                  )
            }
          />
        ))}
        {look.kind === 'inbox' ? (
          <HqpButton
            label="Done"
            ghost
            disabled={busy !== null}
            onPress={() =>
              run(
                'done',
                withClient((rpc) => markHqPlusPhoneDone(rpc, card, 'done'))
              )
            }
          />
        ) : null}
      </HqpButtons>
      {hints.length > 0 ? <Text style={hqpStyles.hint}>{hints[0]}</Text> : null}
    </>
  )
}

const styles = StyleSheet.create({
  note: { color: hqp.mute, fontSize: 12 },
  fold: { gap: 6 },
  onMac: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,107,98,.45)',
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 4,
    minHeight: 44,
    justifyContent: 'center'
  },
  onMacLabel: { color: hqp.rose, fontSize: 14, fontWeight: '600' },
  replyRow: { gap: 8 },
  replyInput: {
    minHeight: 44,
    maxHeight: 140,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: hqp.line2,
    backgroundColor: hqp.bg,
    color: hqp.fg,
    fontSize: 14.5,
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  collapse: { alignSelf: 'flex-end' }
})
