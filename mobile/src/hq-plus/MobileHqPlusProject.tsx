// Custom build (hq-plus-phone-map): a project picked on the phone's Map, on a screen from the right
// (‹ Map or a swipe from the edge goes back). Custom build (hq-project-cards): the screen shows the
// feed's own project card — the lines on the owner decided in place, whom we wait for, today's work and
// its chats with ×.
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import type { HqPlusProjectCard } from '../../../src/shared/hq-plus-project-cards'
import type { HqpMapRoom } from './hq-plus-phone-map'
import { HQP_TOUCH, hqp, hqpStyles, hqpWeb } from './hq-plus-phone-theme'
import { MobileHqPlusProjectCard } from './MobileHqPlusProjectCard'
import type { HqpProjectContext } from './MobileHqPlusProjectParts'

export function MobileHqPlusProject({
  room,
  slug,
  card,
  ctx,
  onBack
}: {
  room: HqpMapRoom | null
  /** The project on screen; null keeps the screen off to the right. */
  slug: string | null
  card: HqPlusProjectCard | null
  ctx: HqpProjectContext
  onBack: () => void
}) {
  const shown = slug !== null
  const unsorted = card?.unsorted ?? false
  const name = unsorted ? 'Unsorted' : (slug ?? '')
  return (
    <View
      aria-hidden={!shown}
      pointerEvents={shown ? 'auto' : 'none'}
      style={[
        styles.panel,
        hqpWeb.grid,
        hqpWeb.slide,
        { transform: [{ translateX: shown ? 0 : '102%' }] }
      ]}
      testID="hq-plus-project"
    >
      <View style={styles.top}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to the Map"
          onPress={onBack}
          style={styles.back}
        >
          <Text style={styles.backText}>‹ Map</Text>
        </Pressable>
        <View style={styles.title}>
          <Text style={styles.titleText} numberOfLines={1}>
            {name}
          </Text>
          <Text style={styles.titleSub}>
            {(room?.name ?? '').toUpperCase()} · {unsorted ? 'NO PROJECT' : 'PROJECT'}
          </Text>
        </View>
        <View style={styles.back} />
      </View>
      <ScrollView style={hqpWeb.noScrollbar} contentContainerStyle={styles.body}>
        {card ? (
          <MobileHqPlusProjectCard key={card.slug} card={card} ctx={ctx} />
        ) : (
          <Text style={hqpStyles.hint}>Nothing goes on in this project now.</Text>
        )}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 7,
    boxShadow: '-20px 0 40px rgba(0,0,0,.5)'
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: hqp.line,
    backgroundColor: hqp.bg
  },
  back: { width: 96, height: HQP_TOUCH, justifyContent: 'center', paddingHorizontal: 8 },
  backText: { color: hqp.ice, fontSize: 15, fontWeight: '500' },
  title: { flex: 1, alignItems: 'center', minWidth: 0 },
  titleText: { color: hqp.fg, fontSize: 14.5, fontWeight: '600' },
  titleSub: { color: hqp.faint, fontFamily: hqp.mono, fontSize: 10.5, letterSpacing: 0.8 },
  body: { paddingHorizontal: 12, paddingTop: 14, paddingBottom: 48, gap: 12 }
})
