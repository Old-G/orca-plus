// Custom build (hq-plus-phone-map): HQ+'s Map on the phone (owner, 31.10: «да» to the mockup, 1A 2A) —
// the room's sources from outside, then its projects as tiles in two columns: what waits on the
// owner in large amber, how many waits and the oldest, the chats as dots by state. All shows each
// room under its own line. A tap opens the project's screen from the right.
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import type { HqPlusSource } from '../../../src/shared/hq-plus-kinds'
import type { HqPlusMapProject } from '../../../src/shared/hq-plus-map'
import { hqPlusPhoneBreakName, hqPlusPhoneDays, type HqpMapRoom } from './hq-plus-phone-map'
import { hqp, hqpStyles, hqpWeb } from './hq-plus-phone-theme'
import { HQP_CHAT_STATE_COLOR } from './MobileHqPlusMapChats'

export const HQP_SOURCE_COLOR: Record<HqPlusSource, string> = {
  slack: hqp.green,
  clickup: hqp.violet,
  gmail: '#ff8a80',
  gitlab: '#fb923c'
}

export const HQP_SOURCE_NAME: Record<HqPlusSource, string> = {
  slack: 'Slack',
  clickup: 'ClickUp',
  gmail: 'Gmail',
  gitlab: 'GitLab'
}

function Tile({
  project,
  color,
  now,
  onPress
}: {
  project: HqPlusMapProject
  color: string
  now: number
  onPress: () => void
}) {
  const chatDots = project.leaves.flatMap((leaf) => (leaf.kind === 'chat' ? [leaf] : []))
  const meta = [
    project.waits > 0 ? `${project.waits} wait${project.waits === 1 ? '' : 's'}` : null,
    project.oldestWaitAt !== null ? `${hqPlusPhoneDays(project.oldestWaitAt, now)} d` : null
  ]
    .filter(Boolean)
    .join(' · ')
  const name = project.unsorted ? 'Unsorted' : project.slug
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Project ${name}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tile,
        // Why: a flat background paints over the amber edge's border-box gradient.
        project.unsorted
          ? styles.tileUnsorted
          : project.you > 0
            ? [hqpWeb.edgeMove, styles.tileMove]
            : styles.tilePlain,
        pressed && styles.pressed
      ]}
    >
      <View style={styles.name}>
        <View style={[styles.dot, { backgroundColor: color }]} />
        <Text style={styles.nameText}>{hqPlusPhoneBreakName(name)}</Text>
        <View style={styles.sourceDots}>
          {(Object.keys(project.sources) as HqPlusSource[]).map((source) => (
            <View
              key={source}
              style={[styles.small, { backgroundColor: HQP_SOURCE_COLOR[source] }]}
            />
          ))}
        </View>
      </View>
      {project.you > 0 ? (
        <View style={styles.you}>
          <Text style={styles.youCount}>{project.you}</Text>
          <Text style={styles.youLabel}>YOUR MOVE</Text>
        </View>
      ) : (
        <View style={styles.you}>
          <Text style={[styles.youLabel, styles.noneLabel]}>
            {project.unsorted ? 'NOTHING TO SORT' : 'NOTHING FOR YOU'}
          </Text>
        </View>
      )}
      <View style={styles.meta}>
        <Text style={styles.metaText} numberOfLines={1}>
          {meta || (project.chats > 0 ? '' : 'quiet')}
        </Text>
        {project.chats > 0 ? (
          <View style={styles.chatDots}>
            {chatDots.map((leaf) => (
              <View
                key={leaf.key}
                style={[styles.chatDot, { backgroundColor: HQP_CHAT_STATE_COLOR[leaf.state] }]}
              />
            ))}
            <Text style={styles.chatCount}>{project.chats}</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  )
}

function Tiles({
  room,
  now,
  colorOf,
  onProject
}: {
  room: HqpMapRoom
  now: number
  colorOf: (project: string) => string | null
  onProject: (room: string, slug: string) => void
}) {
  return (
    <View style={styles.tiles}>
      {room.model.projects.map((project) => (
        <View key={project.slug} style={styles.cell}>
          <Tile
            project={project}
            color={project.unsorted ? hqp.faint : (colorOf(project.slug) ?? room.color)}
            now={now}
            onPress={() => onProject(room.slug, project.slug)}
          />
        </View>
      ))}
    </View>
  )
}

export function MobileHqPlusMap({
  rooms,
  all,
  now,
  colorOf,
  onProject
}: {
  rooms: readonly HqpMapRoom[]
  /** All: every room under its own line, without the sources. */
  all: boolean
  now: number
  colorOf: (project: string) => string | null
  onProject: (room: string, slug: string) => void
}) {
  return (
    <ScrollView
      style={[styles.scroll, hqpWeb.noScrollbar]}
      contentContainerStyle={styles.content}
      testID="hq-plus-map"
    >
      {rooms.length === 0 ? <Text style={[hqpStyles.hint, styles.empty]}>Loading HQ+…</Text> : null}
      {rooms.map((room) => {
        const you = room.model.projects.reduce((sum, project) => sum + project.you, 0)
        return (
          <View key={room.slug} style={styles.room}>
            {all ? (
              <View style={styles.roomHead}>
                <View style={[styles.roomDot, { backgroundColor: room.color }]} />
                <Text style={[hqpStyles.label, { color: hqp.mute }]}>{room.name}</Text>
                {you > 0 ? <Text style={styles.roomYou}>{you} your move</Text> : null}
              </View>
            ) : (
              <View style={styles.hub}>
                <Text style={[hqpStyles.label, styles.hubLabel]}>{room.name} · from outside</Text>
                {room.model.sources.length === 0 ? (
                  <Text style={hqpStyles.hint}>
                    No conversations from Slack, ClickUp, Gmail or GitLab in this room today.
                  </Text>
                ) : (
                  room.model.sources.map(({ source, count }) => (
                    <View key={source} style={styles.source}>
                      <View style={[styles.small, { backgroundColor: HQP_SOURCE_COLOR[source] }]} />
                      <Text style={styles.sourceText}>
                        {HQP_SOURCE_NAME[source]} <Text style={styles.sourceCount}>{count}</Text>
                      </Text>
                    </View>
                  ))
                )}
              </View>
            )}
            {room.model.projects.length === 0 ? (
              <Text style={hqpStyles.hint}>Nothing in this room yet.</Text>
            ) : (
              <Tiles room={room} now={now} colorOf={colorOf} onProject={onProject} />
            )}
          </View>
        )
      })}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { paddingHorizontal: 12, paddingTop: 12, paddingBottom: 16, gap: 12 },
  empty: { textAlign: 'center', paddingVertical: 40 },
  room: { gap: 12 },
  roomHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingTop: 6,
    paddingHorizontal: 2
  },
  roomDot: { width: 8, height: 8, borderRadius: 4 },
  roomYou: { marginLeft: 'auto', color: hqp.amber, fontFamily: hqp.mono, fontSize: 11 },
  hub: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 12,
    rowGap: 4,
    paddingTop: 2,
    paddingHorizontal: 2
  },
  hubLabel: { width: '100%' },
  source: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  sourceText: { color: hqp.mute, fontFamily: hqp.mono, fontSize: 11.5 },
  sourceCount: { color: hqp.fg, fontWeight: '500' },
  small: { width: 6, height: 6, borderRadius: 3 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -5, rowGap: 10 },
  cell: { width: '50%', paddingHorizontal: 5 },
  tile: {
    flex: 1,
    minHeight: 120,
    borderRadius: 14,
    paddingTop: 11,
    paddingHorizontal: 12,
    paddingBottom: 10,
    gap: 6,
    borderWidth: 1,
    justifyContent: 'space-between'
  },
  // Why: react-native-web drops the gradient border's clip, so the amber edge is drawn as a line too.
  tileMove: { borderColor: 'rgba(255,195,90,.55)' },
  tilePlain: { backgroundColor: hqp.card, borderColor: hqp.line },
  tileUnsorted: { borderStyle: 'dashed', borderColor: hqp.line2, backgroundColor: 'transparent' },
  pressed: { transform: [{ scale: 0.985 }] },
  name: { flexDirection: 'row', alignItems: 'flex-start', gap: 7 },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 4 },
  nameText: {
    flex: 1,
    minWidth: 0,
    color: hqp.fg,
    fontSize: 13.5,
    fontWeight: '600',
    lineHeight: 17
  },
  sourceDots: { flexDirection: 'row', gap: 3, paddingTop: 3 },
  you: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  youCount: {
    color: hqp.amber,
    fontFamily: hqp.mono,
    fontSize: 28,
    fontWeight: '600',
    lineHeight: 30
  },
  youLabel: {
    color: hqp.amber,
    fontFamily: hqp.mono,
    fontSize: 9.5,
    fontWeight: '500',
    letterSpacing: 1.2
  },
  noneLabel: { color: hqp.faint, letterSpacing: 0.8 },
  meta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  metaText: { flex: 1, minWidth: 0, color: hqp.mute, fontSize: 11.5 },
  chatDots: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  chatDot: { width: 7, height: 7, borderRadius: 4 },
  chatCount: { color: hqp.mute, fontFamily: hqp.mono, fontSize: 11, marginLeft: 3 }
})
