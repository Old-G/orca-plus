// Custom build (hq-spaces): the phone's workspace picker above HQ's pinned pages — «All» or one
// workspace, each with its colour; hidden until the Mac's global HQ has a workspace.
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import type { HqSpace } from '../../../src/shared/hq-spaces'
import { colors, radii, spacing, typography } from '../theme/mobile-theme'

function Chip({
  label,
  color,
  selected,
  onPress
}: {
  label: string
  color: string | null
  selected: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      <View style={[styles.dot, color ? { backgroundColor: color } : null]} />
      <Text style={[styles.label, selected && styles.labelSelected]}>{label}</Text>
    </Pressable>
  )
}

export function MobileHqSpaceSwitch({
  spaces,
  active,
  onChange
}: {
  spaces: readonly HqSpace[]
  active: string | null
  onChange: (slug: string | null) => void
}) {
  if (spaces.length === 0) {
    return null
  }
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityRole="tablist"
      contentContainerStyle={styles.row}
    >
      <Chip label="All" color={null} selected={active === null} onPress={() => onChange(null)} />
      {spaces.map((space) => (
        <Chip
          key={space.slug}
          label={space.name}
          color={space.color}
          selected={active === space.slug}
          onPress={() => onChange(space.slug)}
        />
      ))}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  row: { gap: spacing.xs },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.md,
    borderRadius: radii.button,
    backgroundColor: colors.bgPanel
  },
  chipSelected: { backgroundColor: colors.bgRaised },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.textMuted },
  label: { fontSize: typography.metaSize, color: colors.textSecondary },
  labelSelected: { color: colors.textPrimary, fontWeight: '600' }
})
