// Custom build (hq-project-cards): HQ+'s feed on the phone as one card per project, in the desktop's order
// — the owner's move first, then work and chats, then where we only wait, Unsorted last — and one dashed
// FYI row at the bottom that opens the FYI chip. A line picked in the menu opens in its card, which
// scrolls into view.
import { useEffect, useRef } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import type {
  HqPlusProjectFeed,
  HqPlusProjectFilter
} from '../../../src/shared/hq-plus-project-cards'
import { hqp, hqpStyles, hqpWeb } from './hq-plus-phone-theme'
import { MobileHqPlusProjectCard } from './MobileHqPlusProjectCard'
import type { HqpProjectContext } from './MobileHqPlusProjectParts'

export function MobileHqPlusProjectFeed({
  feed,
  filter,
  ctx,
  flash,
  empty,
  onFilter
}: {
  feed: HqPlusProjectFeed
  filter: HqPlusProjectFilter
  ctx: HqpProjectContext
  /** The line to open and bring into view, with a counter so the same line can be asked again. */
  flash: { id: string; n: number } | null
  empty: string
  onFilter: (filter: HqPlusProjectFilter) => void
}) {
  const scroll = useRef<ScrollView>(null)
  const offsets = useRef(new Map<string, number>())
  const flashSlug = flash
    ? (feed.cards.find((card) => [...card.you, ...card.fyi].some((line) => line.id === flash.id))
        ?.slug ?? null)
    : null

  useEffect(() => {
    const y = flashSlug ? offsets.current.get(flashSlug) : undefined
    if (y !== undefined) {
      scroll.current?.scrollTo({ y: Math.max(0, y - 12), animated: true })
    }
  }, [flash, flashSlug])

  const yours = feed.cards.filter((card) => card.you.length > 0 && !card.unsorted)
  const marks = filter === 'all' && yours.length > 0 && yours.length < feed.cards.length
  return (
    <ScrollView
      ref={scroll}
      style={[styles.scroll, hqpWeb.noScrollbar]}
      contentContainerStyle={styles.content}
      testID="hq-plus-feed"
    >
      {feed.cards.length === 0 && (filter !== 'all' || feed.fyi.length === 0) ? (
        <Text style={[hqpStyles.hint, styles.empty]}>{empty}</Text>
      ) : null}
      {feed.cards.map((card, index) => (
        <View
          key={card.slug}
          style={styles.item}
          onLayout={(event) => offsets.current.set(card.slug, event.nativeEvent.layout.y)}
        >
          {marks && index === 0 ? <Text style={styles.group}>YOUR MOVE</Text> : null}
          {marks && index === yours.length ? (
            <Text style={styles.group}>WE WAIT · DONE TODAY</Text>
          ) : null}
          <MobileHqPlusProjectCard
            card={card}
            ctx={ctx}
            flashId={flashSlug === card.slug ? (flash?.id ?? null) : null}
            openId={flashSlug === card.slug ? (flash?.id ?? null) : null}
          />
        </View>
      ))}
      {filter === 'all' && feed.fyi.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Show FYI"
          onPress={() => onFilter('fyi')}
          style={({ pressed }) => [styles.fyi, pressed && hqpStyles.pressed]}
        >
          <Text style={styles.fyiText}>
            <Text style={styles.fyiLabel}>FYI · {feed.counts.fyi} </Text>
            {feed.fyi
              .map((row) => `${row.slug} · ${row.count > 1 ? row.count : row.what}`)
              .join('   ')}
          </Text>
        </Pressable>
      ) : null}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { paddingHorizontal: 12, paddingTop: 12, paddingBottom: 16, gap: 12 },
  item: { gap: 8 },
  empty: { textAlign: 'center', paddingVertical: 40 },
  group: {
    fontFamily: hqp.mono,
    fontSize: 10.5,
    letterSpacing: 1.6,
    color: hqp.faint,
    paddingHorizontal: 2
  },
  fyi: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: hqp.line,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12
  },
  fyiText: { color: hqp.mute, fontSize: 13, lineHeight: 19 },
  fyiLabel: { color: hqp.faint, fontFamily: hqp.mono, fontSize: 11, letterSpacing: 1.2 }
})
