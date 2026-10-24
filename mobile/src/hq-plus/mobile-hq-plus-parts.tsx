// Custom build (hq-plus-phone): the pieces HQ+'s phone cards share — the desktop's badge per event
// kind, the project tile, a 44-pt button, a card frame with the desktop's gradient edge.
import type { ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import type {
  HqPlusBadge,
  HqPlusBadgeTone,
  HqPlusLookKind
} from '../../../src/shared/hq-plus-kinds'
import { hqChatInitials } from '../hq/MobileHqChatList'
import { hqp, hqpStyles, hqpWeb } from './hq-plus-phone-theme'

const TONE: Record<HqPlusBadgeTone, string> = {
  move: hqp.amber,
  approve: hqp.red,
  chat: hqp.ice,
  report: hqp.violet,
  slack: hqp.slack,
  clickup: hqp.violet,
  gmail: hqp.rose,
  bg: hqp.faint,
  working: hqp.yellow,
  waits: hqp.amber,
  done: hqp.green
}

/** `#rrggbb` at an alpha, for a badge's fill and border. */
function alpha(hex: string, a: number): string {
  const n = Number.parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

export function HqpBadge({ badge }: { badge: HqPlusBadge }) {
  const color = TONE[badge.tone]
  return (
    <Text
      style={[
        styles.badge,
        { color, borderColor: alpha(color, 0.55), backgroundColor: alpha(color, 0.1) }
      ]}
    >
      {badge.label}
    </Text>
  )
}

const TILE_COLORS = ['#4a2e54', '#1f4d3a', '#54422a', '#28465a', '#5a2a2a', '#2e3f5a']

export function HqpTile({ name, color }: { name: string | null; color?: string | null }) {
  const label = name ?? 'HQ'
  const fallback = TILE_COLORS[[...label].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 6]
  return (
    <View style={[styles.tile, { backgroundColor: color ?? fallback }]}>
      <Text style={styles.tileText}>{hqChatInitials(label)}</Text>
    </View>
  )
}

export function HqpButton({
  label,
  main = false,
  ghost = false,
  disabled = false,
  onPress
}: {
  label: string
  main?: boolean
  ghost?: boolean
  disabled?: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        hqpStyles.button,
        main && hqpStyles.buttonMain,
        ghost && hqpStyles.buttonGhost,
        (pressed || disabled) && hqpStyles.pressed
      ]}
    >
      <Text
        style={[
          hqpStyles.buttonLabel,
          main && hqpStyles.buttonLabelMain,
          ghost && hqpStyles.buttonLabelGhost
        ]}
        numberOfLines={2}
      >
        {label}
      </Text>
    </Pressable>
  )
}

export function HqpButtons({ children }: { children: ReactNode }) {
  return <View style={styles.buttons}>{children}</View>
}

/** A feed row: the project's tile, then its card with the edge its kind wears on the desktop. */
export function HqpCardFrame({
  look,
  approve = false,
  flash,
  project,
  color,
  children
}: {
  look: HqPlusLookKind
  approve?: boolean
  flash: boolean
  project: string | null
  color: string | null
  children: ReactNode
}) {
  const edge = approve ? hqpWeb.edgeApprove : look === 'move' ? hqpWeb.edgeMove : hqpWeb.edge
  return (
    <View style={styles.row}>
      <HqpTile name={project} color={color} />
      <View style={[styles.card, look === 'chat' ? styles.cardChat : edge, flash && styles.flash]}>
        {children}
      </View>
    </View>
  )
}

export function HqpHead({ children }: { children: ReactNode }) {
  return <View style={styles.head}>{children}</View>
}

export function clock(at: number | null): string {
  return at ? new Date(at).toTimeString().slice(0, 5) : ''
}

export const hqpCardStyles = StyleSheet.create({
  project: { color: hqp.fg, fontWeight: '600', fontSize: 13.5 },
  chatName: { color: hqp.mute, fontSize: 12.5 },
  time: { color: hqp.faint, fontFamily: hqp.mono, fontSize: 10.5 },
  spacer: { flexGrow: 1 },
  text: { color: hqp.fg, fontSize: 14, lineHeight: 20 },
  question: { color: hqp.fg, fontSize: 14.5, lineHeight: 21 },
  said: {
    backgroundColor: hqp.soft2,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    color: hqp.fg,
    fontSize: 13.5,
    lineHeight: 19
  },
  saidWho: { color: hqp.rose, fontWeight: '600' },
  foot: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  done: { color: hqp.green, fontSize: 12.5 }
})

const styles = StyleSheet.create({
  badge: {
    fontFamily: hqp.mono,
    fontSize: 9.5,
    lineHeight: 17,
    letterSpacing: 1.1,
    paddingHorizontal: 6,
    borderRadius: 5,
    borderWidth: 1,
    overflow: 'hidden'
  },
  tile: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center'
  },
  tileText: { color: '#ffffff', fontSize: 10, fontWeight: '700' },
  row: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  card: {
    flex: 1,
    minWidth: 0,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 11,
    paddingHorizontal: 12,
    gap: 8
  },
  cardChat: { backgroundColor: hqp.card, borderColor: hqp.line },
  flash: { boxShadow: '0 0 0 3px rgba(255,195,90,.35)' },
  head: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 7, rowGap: 4 },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }
})
