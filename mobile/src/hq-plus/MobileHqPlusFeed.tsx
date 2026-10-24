// Custom build (hq-plus-phone): the feed in the centre — the day's log oldest first, newest at the
// bottom like a chat, a day mark where the day changes. Kept at the bottom while new rows come, unless
// the owner scrolled up; a row picked in the menu scrolls into view and flashes.
import { useEffect, useRef } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import type { HqPlusLogItem } from '../../../src/shared/hq-plus-log'
import { hqPlusLook } from '../../../src/shared/hq-plus-kinds'
import { hqp, hqpStyles, hqpWeb } from './hq-plus-phone-theme'
import { MobileHqPlusCard } from './MobileHqPlusCard'
import { MobileHqPlusBackground, MobileHqPlusChatLine, MobileHqPlusMine } from './MobileHqPlusLine'
import type { HqpFeedContext } from './mobile-hq-plus-feed-context'

const NEAR_BOTTOM = 120

function dayLabel(at: number, now: number): string {
  const day = new Date(at).toDateString()
  if (day === new Date(now).toDateString()) {
    return 'TODAY'
  }
  if (day === new Date(now - 24 * 60 * 60_000).toDateString()) {
    return 'YESTERDAY'
  }
  return new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }).toUpperCase()
}

function Row({ item, flash, ctx }: { item: HqPlusLogItem; flash: boolean; ctx: HqpFeedContext }) {
  if (item.kind === 'card') {
    return <MobileHqPlusCard card={item} flash={flash} ctx={ctx} />
  }
  if (item.kind === 'me') {
    return <MobileHqPlusMine item={item} />
  }
  return hqPlusLook(item).kind === 'chat' ? (
    <MobileHqPlusChatLine item={item} flash={flash} ctx={ctx} />
  ) : (
    <MobileHqPlusBackground item={item} />
  )
}

export function MobileHqPlusFeed({
  items,
  now,
  ctx,
  flash,
  empty
}: {
  items: readonly HqPlusLogItem[]
  now: number
  ctx: HqpFeedContext
  /** The row to bring into view and flash, with a counter so the same row can be asked again. */
  flash: { id: string; n: number } | null
  empty: string
}) {
  const scroll = useRef<ScrollView>(null)
  const offsets = useRef(new Map<string, number>())
  const atBottom = useRef(true)
  const lastId = items.at(-1)?.id ?? null

  useEffect(() => {
    if (atBottom.current) {
      scroll.current?.scrollToEnd({ animated: false })
    }
  }, [lastId, items.length])

  useEffect(() => {
    const y = flash ? offsets.current.get(flash.id) : undefined
    if (y !== undefined) {
      scroll.current?.scrollTo({ y: Math.max(0, y - 12), animated: true })
    }
  }, [flash])

  let lastDay: string | null = null
  return (
    <ScrollView
      ref={scroll}
      style={[styles.scroll, hqpWeb.noScrollbar]}
      contentContainerStyle={styles.content}
      scrollEventThrottle={64}
      onScroll={(event) => {
        const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent
        atBottom.current =
          contentSize.height - contentOffset.y - layoutMeasurement.height < NEAR_BOTTOM
      }}
      testID="hq-plus-feed"
    >
      {items.length === 0 ? <Text style={[hqpStyles.hint, styles.empty]}>{empty}</Text> : null}
      {items.map((item) => {
        const day = dayLabel(item.at, now)
        const mark = day !== lastDay ? day : null
        lastDay = day
        return (
          <View
            key={item.id}
            style={styles.item}
            onLayout={(event) => offsets.current.set(item.id, event.nativeEvent.layout.y)}
          >
            {mark ? <Text style={styles.day}>{mark}</Text> : null}
            <Row item={item} flash={flash?.id === item.id} ctx={ctx} />
          </View>
        )
      })}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { paddingHorizontal: 12, paddingTop: 12, paddingBottom: 16, gap: 12 },
  item: { gap: 12 },
  empty: { textAlign: 'center', paddingVertical: 40 },
  day: {
    alignSelf: 'center',
    fontFamily: hqp.mono,
    fontSize: 10.5,
    letterSpacing: 1.6,
    color: hqp.faint,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: hqp.line,
    borderRadius: 999,
    backgroundColor: hqp.bg,
    overflow: 'hidden'
  }
})
