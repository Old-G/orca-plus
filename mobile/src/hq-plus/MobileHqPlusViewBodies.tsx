// Custom build (hq-plus-phone): the right panel's views as phone lists, from the desktop's shared
// rules — Agents (the chats by state), River (each project's week: worked / waits on a person),
// Graph (people → projects → systems), Deferred (chats left with unfinished work) and Browser.
import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { HqChatWireItem } from '../../../src/shared/hq-chat-wire'
import type { HqPlusCard } from '../../../src/shared/hq-plus-log'
import type { HqPlusGraph, HqPlusLane } from '../../../src/shared/hq-plus-river-graph'
import { hqAgo } from '../hq/mobile-hq-parts'
import { hqp, hqpStyles } from './hq-plus-phone-theme'
import { MobileHqPlusCard } from './MobileHqPlusCard'
import type { HqpFeedContext } from './mobile-hq-plus-feed-context'
import { HqpButton, HqpButtons, HqpTile } from './mobile-hq-plus-parts'

const GROUPS = [
  { group: 'needs', label: 'Waits on you', tone: hqp.amber },
  { group: 'working', label: 'Working', tone: hqp.yellow },
  { group: 'done', label: 'Done', tone: hqp.green }
] as const

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.block}>
      <Text style={[hqpStyles.label, styles.blockLabel]}>{label}</Text>
      {children}
    </View>
  )
}

export function HqpAgentsView({
  chats,
  now,
  onOpen
}: {
  chats: readonly HqChatWireItem[]
  now: number
  onOpen: (chat: HqChatWireItem) => void
}) {
  return (
    <>
      {GROUPS.map(({ group, label, tone }) => {
        const rows = chats.filter((chat) => chat.group === group)
        return (
          <Block key={group} label={`${label} · ${rows.length}`}>
            {rows.length === 0 ? <Text style={styles.none}>None.</Text> : null}
            {rows.map((chat) => (
              <Pressable
                key={chat.key}
                accessibilityRole="button"
                onPress={() => onOpen(chat)}
                style={({ pressed }) => [styles.row, pressed && hqpStyles.pressed]}
              >
                <HqpTile name={chat.projectName} color={chat.color} />
                <View style={styles.rowBody}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {chat.title}
                  </Text>
                  <Text style={styles.rowMeta} numberOfLines={2}>
                    {chat.projectName} · {chat.preview}
                  </Text>
                </View>
                <Text style={[styles.mono, { color: tone }]}>{hqAgo(chat.sortAt, now)}</Text>
              </Pressable>
            ))}
          </Block>
        )
      })}
    </>
  )
}

function laneNote(lane: HqPlusLane): string {
  switch (lane.note.kind) {
    case 'wait':
      return `waits on ${lane.note.person} · ${lane.note.days} d`
    case 'today':
      return 'worked today'
    case 'quiet':
      return `quiet · ${lane.note.days} d`
  }
}

export function HqpRiverView({ lanes }: { lanes: readonly HqPlusLane[] }) {
  return (
    <Block label="The week by project · oldest left">
      {lanes.length === 0 ? <Text style={styles.none}>No work this week.</Text> : null}
      {lanes.map((lane) => (
        <View key={lane.project} style={styles.lane}>
          <View style={styles.laneHead}>
            <Text style={styles.rowTitle}>{lane.project}</Text>
            <Text style={[styles.mono, lane.wait?.long ? styles.long : null]}>
              {laneNote(lane)}
            </Text>
          </View>
          <View style={styles.track}>
            {lane.work.map(([from, to]) => (
              <View
                key={from}
                style={[styles.work, { left: `${from * 100}%`, width: `${(to - from) * 100}%` }]}
              />
            ))}
            {lane.wait ? (
              <View
                style={[
                  styles.wait,
                  lane.wait.long ? styles.waitLong : null,
                  { left: `${lane.wait.from * 100}%` }
                ]}
              />
            ) : null}
          </View>
        </View>
      ))}
    </Block>
  )
}

export function HqpGraphView({ graph }: { graph: HqPlusGraph }) {
  const label = new Map(
    [...graph.people, ...graph.projects, ...graph.systems].map((node) => [node.id, node.label])
  )
  const links = graph.edges.map((edge) => ({
    key: `${edge.from}>${edge.to}`,
    text: `${label.get(edge.from) ?? edge.from} ${edge.kind === 'relation' || edge.kind === 'member' ? '→' : '┄'} ${label.get(edge.to) ?? edge.to}`,
    tone: edge.kind === 'wait-long' ? hqp.red : edge.kind === 'relation' ? hqp.mute : hqp.amber
  }))
  return (
    <>
      <Block label={`People · ${graph.people.length}`}>
        {graph.people.map((node) => (
          <Text key={node.id} style={styles.node}>
            <Text style={styles.rowTitle}>{node.label}</Text> {node.detail}
          </Text>
        ))}
      </Block>
      <Block label={`Projects · ${graph.projects.length}`}>
        {graph.projects.map((node) => (
          <Text key={node.id} style={styles.node}>
            <Text style={styles.rowTitle}>{node.label}</Text> {node.detail}
            {node.active ? ' · active' : ''}
          </Text>
        ))}
      </Block>
      <Block label="Links · solid = depends on, dashed = waits">
        {links.length === 0 ? <Text style={styles.none}>No links.</Text> : null}
        {links.map((link) => (
          <Text key={link.key} style={[styles.node, { color: link.tone }]}>
            {link.text}
          </Text>
        ))}
      </Block>
    </>
  )
}

export function HqpDeferredView({
  cards,
  ctx
}: {
  cards: readonly HqPlusCard[]
  ctx: HqpFeedContext
}) {
  return (
    <Block label={`Chats left with unfinished work · ${cards.length}`}>
      {cards.length === 0 ? (
        <Text style={styles.none}>No chat is left with unfinished work.</Text>
      ) : null}
      {cards.map((card) => (
        <MobileHqPlusCard key={card.id} card={card} flash={false} ctx={ctx} />
      ))}
    </Block>
  )
}

export function HqpBrowserView({
  url,
  onOrca,
  onSafari,
  onCopy
}: {
  url: string | null
  onOrca: () => void
  onSafari: () => void
  onCopy: () => void
}) {
  return (
    <Block label="Orca browser">
      {url ? (
        <>
          <Text style={styles.url} selectable>
            {url}
          </Text>
          <HqpButtons>
            <HqpButton label="Open in Orca browser" main onPress={onOrca} />
            <HqpButton label="Safari" onPress={onSafari} />
            <HqpButton label="Copy link" ghost onPress={onCopy} />
          </HqpButtons>
          <Text style={hqpStyles.hint}>
            Orca browser opens the page in the HQ workspace on the Mac and streams it here.
          </Text>
        </>
      ) : (
        <Text style={styles.none}>A link tapped in a card opens here.</Text>
      )}
    </Block>
  )
}

const styles = StyleSheet.create({
  block: {
    borderWidth: 1,
    borderColor: hqp.line,
    borderRadius: 14,
    backgroundColor: 'rgba(11,24,35,.75)',
    padding: 14,
    gap: 8
  },
  blockLabel: { color: hqp.ice },
  none: { color: hqp.faint, fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48 },
  rowBody: { flex: 1, minWidth: 0 },
  rowTitle: { color: hqp.fg, fontSize: 14, fontWeight: '600' },
  rowMeta: { color: hqp.faint, fontSize: 12 },
  mono: { color: hqp.faint, fontFamily: hqp.mono, fontSize: 10.5 },
  long: { color: hqp.red },
  lane: { gap: 6, paddingVertical: 4 },
  laneHead: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  track: {
    height: 8,
    borderRadius: 4,
    backgroundColor: hqp.soft,
    overflow: 'hidden',
    position: 'relative'
  },
  work: { position: 'absolute', top: 0, bottom: 0, backgroundColor: hqp.green, borderRadius: 4 },
  wait: {
    position: 'absolute',
    top: 3,
    height: 2,
    right: 0,
    borderTopWidth: 2,
    borderStyle: 'dashed',
    borderColor: hqp.amber
  },
  waitLong: { borderColor: hqp.red },
  node: { color: hqp.mute, fontSize: 13.5, lineHeight: 20 },
  url: { color: hqp.faint, fontFamily: hqp.mono, fontSize: 12 }
})
