// Custom build (hq-plus-phone): the top of HQ+ on the phone — ☰ with the «your move» count, the rooms
// as tabs that scroll sideways (All first, «+» last), search and the views; then the feed's chips.
import type { ComponentType } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { Menu, Search, Waypoints } from 'lucide-react-native'
import {
  HQ_PLUS_FEED_FILTERS,
  type HqPlusFeedFilter
} from '../../../src/shared/hq-plus-feed-filter'
import type { HqSpace } from '../../../src/shared/hq-spaces'
import { HQP_TOUCH, hqp, hqpWeb } from './hq-plus-phone-theme'

const FILTER_LABEL: Record<HqPlusFeedFilter, string> = {
  all: 'All',
  move: 'Your move',
  chats: 'Chats',
  inbox: 'Inbox'
}

function Icon({
  label,
  glyph: Glyph,
  count,
  onPress
}: {
  label: string
  glyph: ComponentType<{ size?: number; color?: string; strokeWidth?: number }>
  count?: number
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.icon, pressed && styles.pressed]}
    >
      <Glyph size={22} color={hqp.fg} strokeWidth={1.8} />
      {count ? <Text style={styles.count}>{count}</Text> : null}
    </Pressable>
  )
}

export function MobileHqPlusHeader({
  spaces,
  room,
  openByRoom,
  moveCount,
  filter,
  inboxCount,
  search,
  onMenu,
  onRoom,
  onNewRoom,
  onSearch,
  onViews,
  onFilter
}: {
  spaces: readonly HqSpace[]
  room: string | null
  openByRoom: ReadonlyMap<string, number>
  moveCount: number
  filter: HqPlusFeedFilter
  inboxCount: number
  /** The search field's words, or null while it is closed. */
  search: string | null
  onMenu: () => void
  onRoom: (slug: string | null) => void
  onNewRoom: () => void
  onSearch: (query: string | null) => void
  onViews: () => void
  onFilter: (filter: HqPlusFeedFilter) => void
}) {
  const all = [...openByRoom.values()].reduce((sum, n) => sum + n, 0)
  const tabs = [
    { slug: null, name: 'All', color: '#cfe9f2', count: all },
    ...spaces.map((space) => ({
      slug: space.slug,
      name: space.name,
      color: space.color,
      count: openByRoom.get(space.slug) ?? 0
    }))
  ]
  return (
    <View style={styles.wrap}>
      <View style={styles.top}>
        <Icon
          label="Menu: waiting on you, chats, views"
          glyph={Menu}
          count={moveCount}
          onPress={onMenu}
        />
        <ScrollView
          horizontal
          style={[styles.rooms, hqpWeb.noScrollbar]}
          contentContainerStyle={styles.roomsRow}
          accessibilityRole="toolbar"
          accessibilityLabel="Rooms"
        >
          {tabs.map((tab) => {
            const on = tab.slug === room
            return (
              <Pressable
                key={tab.slug ?? '_all'}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={tab.name}
                onPress={() => onRoom(tab.slug)}
                style={[styles.roomTab, on && styles.roomTabOn]}
              >
                <View style={[styles.dot, { backgroundColor: tab.color }]} />
                <Text style={[styles.roomName, on && styles.roomNameOn]}>{tab.name}</Text>
                {tab.count > 0 ? <Text style={styles.roomCount}>{tab.count}</Text> : null}
              </Pressable>
            )
          })}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="New room"
            onPress={onNewRoom}
            style={styles.roomTab}
          >
            <Text style={styles.roomName}>+</Text>
          </Pressable>
        </ScrollView>
        <Icon
          label="Search the feed"
          glyph={Search}
          onPress={() => onSearch(search === null ? '' : null)}
        />
        <Icon label="Agents and views" glyph={Waypoints} onPress={onViews} />
      </View>
      {search !== null ? (
        <View style={styles.searchRow}>
          <TextInput
            autoFocus
            value={search}
            onChangeText={onSearch}
            placeholder="Search: words, project, person"
            placeholderTextColor={hqp.faint}
            accessibilityLabel="Search the feed"
            style={styles.search}
          />
        </View>
      ) : null}
      <ScrollView
        horizontal
        style={[styles.chips, hqpWeb.noScrollbar]}
        contentContainerStyle={styles.chipsRow}
        accessibilityRole="toolbar"
        accessibilityLabel="Feed filter"
      >
        {HQ_PLUS_FEED_FILTERS.map((entry) => {
          const on = entry === filter
          const move = entry === 'move'
          const count = move ? moveCount : entry === 'inbox' ? inboxCount : 0
          return (
            <Pressable
              key={entry}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`Show ${FILTER_LABEL[entry]}`}
              onPress={() => onFilter(entry)}
              style={[
                styles.chip,
                move && styles.chipMove,
                on && (move ? styles.chipMoveOn : styles.chipOn)
              ]}
            >
              <Text
                style={[
                  styles.chipLabel,
                  move && styles.chipLabelMove,
                  on && (move ? styles.chipLabelMoveOn : styles.chipLabelOn)
                ]}
              >
                {FILTER_LABEL[entry]}
                {count > 0 ? <Text style={styles.chipCount}> {count}</Text> : null}
              </Text>
            </Pressable>
          )
        })}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { borderBottomWidth: 1, borderBottomColor: hqp.line },
  top: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10 },
  icon: {
    width: HQP_TOUCH,
    height: HQP_TOUCH,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center'
  },
  pressed: { backgroundColor: hqp.soft2 },
  count: {
    position: 'absolute',
    top: 5,
    right: 4,
    minWidth: 17,
    height: 17,
    paddingHorizontal: 4,
    borderRadius: 9,
    overflow: 'hidden',
    backgroundColor: hqp.amber,
    color: hqp.amberInk,
    fontFamily: hqp.mono,
    fontSize: 10.5,
    fontWeight: '600',
    lineHeight: 17,
    textAlign: 'center'
  },
  rooms: { flex: 1, minWidth: 0 },
  roomsRow: { gap: 2, alignItems: 'center' },
  roomTab: {
    height: 36,
    minWidth: 36,
    paddingHorizontal: 11,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7
  },
  roomTabOn: { backgroundColor: hqp.soft2 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  roomName: { color: hqp.mute, fontSize: 14, fontWeight: '500' },
  roomNameOn: { color: hqp.fg },
  roomCount: { color: hqp.amber, fontFamily: hqp.mono, fontSize: 11 },
  searchRow: { paddingHorizontal: 12, paddingBottom: 4 },
  search: {
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: hqp.line2,
    backgroundColor: hqp.card,
    color: hqp.fg,
    paddingHorizontal: 12,
    fontSize: 14.5
  },
  chips: { flexGrow: 0 },
  chipsRow: { gap: 6, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 10 },
  chip: {
    height: 32,
    paddingHorizontal: 13,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: hqp.line,
    justifyContent: 'center'
  },
  chipOn: { backgroundColor: hqp.ice, borderColor: hqp.ice },
  chipMove: { borderColor: 'rgba(255,195,90,.5)' },
  chipMoveOn: { backgroundColor: hqp.amber, borderColor: hqp.amber },
  chipLabel: { color: hqp.mute, fontSize: 13, fontWeight: '500' },
  chipLabelOn: { color: hqp.ink },
  chipLabelMove: { color: hqp.amber },
  chipLabelMoveOn: { color: hqp.amberInk },
  chipCount: { fontFamily: hqp.mono, fontSize: 11 }
})
