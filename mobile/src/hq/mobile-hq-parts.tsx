// Custom build (hq-mobile): the pieces HQ's phone tabs share — a button, an age, the styles.
import { Pressable, StyleSheet, Text } from 'react-native'
import { colors, radii, spacing, typography } from '../theme/mobile-theme'
import { TEXT_INPUT_FONT_SIZE } from '../platform/text-input-font-size'

export function hqAgo(at: number, now: number): string {
  const minutes = Math.max(0, Math.round((now - at) / 60_000))
  return minutes < 60
    ? `${minutes}m`
    : minutes < 24 * 60
      ? `${Math.round(minutes / 60)}h`
      : `${Math.round(minutes / (24 * 60))}d`
}

export function HqActionButton({
  label,
  primary = false,
  disabled = false,
  onPress
}: {
  label: string
  primary?: boolean
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
        hqStyles.button,
        primary && hqStyles.buttonPrimary,
        (pressed || disabled) && hqStyles.pressed
      ]}
    >
      <Text style={[hqStyles.buttonLabel, primary && hqStyles.buttonLabelPrimary]}>{label}</Text>
    </Pressable>
  )
}

export const hqStyles = StyleSheet.create({
  section: {
    fontSize: typography.metaSize,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    marginTop: spacing.sm
  },
  card: {
    backgroundColor: colors.bgPanel,
    borderRadius: radii.card,
    padding: spacing.md,
    gap: spacing.sm
  },
  stack: { gap: spacing.sm },
  list: {
    backgroundColor: colors.bgPanel,
    borderRadius: radii.card,
    paddingHorizontal: spacing.md
  },
  row: {
    gap: 2,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle
  },
  line: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  title: { flex: 1, fontSize: typography.bodySize, color: colors.textPrimary },
  label: { fontSize: typography.metaSize, color: colors.textSecondary },
  meta: { fontSize: typography.metaSize, color: colors.textMuted },
  link: { fontSize: typography.bodySize, color: colors.accentBlue },
  error: { fontSize: typography.metaSize, color: colors.statusRed },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  button: {
    backgroundColor: colors.bgRaised,
    borderRadius: radii.button,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md
  },
  buttonPrimary: { backgroundColor: colors.surfaceBright },
  buttonLabel: { fontSize: typography.bodySize, fontWeight: '600', color: colors.textPrimary },
  buttonLabelPrimary: { color: colors.bgBase },
  pressed: { opacity: 0.6 },
  input: {
    backgroundColor: colors.bgRaised,
    borderRadius: radii.input,
    padding: spacing.sm,
    color: colors.textPrimary,
    fontSize: TEXT_INPUT_FONT_SIZE
  }
})
