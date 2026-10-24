// Custom build (hq-plus-phone): where a tapped link opens, as the desktop's link popover asks —
// Orca's browser (the HQ workspace's, streamed to the phone), the phone's browser, or copied.
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { HQP_TOUCH, hqp, hqpWeb } from './hq-plus-phone-theme'

export type HqpLinkChoice = 'orca' | 'safari' | 'copy'

function Choice({ label, note, onPress }: { label: string; note?: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.choice, pressed && styles.pressed]}
    >
      <Text style={styles.label}>{label}</Text>
      {note ? <Text style={styles.note}>{note}</Text> : null}
    </Pressable>
  )
}

export function MobileHqPlusLinkSheet({
  url,
  bottom,
  onPick,
  onClose
}: {
  url: string | null
  /** The home indicator's inset. */
  bottom: number
  onPick: (choice: HqpLinkChoice) => void
  onClose: () => void
}) {
  const open = url !== null
  return (
    <>
      <Pressable
        accessibilityLabel="Close"
        onPress={onClose}
        pointerEvents={open ? 'auto' : 'none'}
        style={[styles.scrim, hqpWeb.slide, { opacity: open ? 1 : 0 }]}
      />
      <View
        accessibilityRole="menu"
        aria-hidden={!open}
        style={[
          styles.sheet,
          hqpWeb.slide,
          { paddingBottom: bottom + 16, transform: [{ translateY: open ? 0 : '105%' }] }
        ]}
        testID="hq-plus-link-sheet"
      >
        <View style={styles.grab} />
        <Text style={styles.url} numberOfLines={3}>
          {url ?? ''}
        </Text>
        <Choice label="Orca Browser" note="in HQ+" onPress={() => onPick('orca')} />
        <Choice label="Safari" note="system" onPress={() => onPick('safari')} />
        <Choice label="Copy link" onPress={() => onPick('copy')} />
        <Pressable
          accessibilityRole="button"
          onPress={onClose}
          style={({ pressed }) => [styles.choice, styles.cancel, pressed && styles.pressed]}
        >
          <Text style={[styles.label, styles.cancelLabel]}>Cancel</Text>
        </Pressable>
      </View>
    </>
  )
}

const styles = StyleSheet.create({
  scrim: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 8,
    backgroundColor: 'rgba(0,0,0,0.5)'
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 9,
    backgroundColor: hqp.sheet,
    borderTopWidth: 1,
    borderTopColor: hqp.line2,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 8,
    paddingHorizontal: 14,
    gap: 6
  },
  grab: {
    width: 38,
    height: 5,
    borderRadius: 3,
    backgroundColor: hqp.line2,
    alignSelf: 'center',
    marginBottom: 6
  },
  url: {
    color: hqp.faint,
    fontFamily: hqp.mono,
    fontSize: 12,
    paddingHorizontal: 4,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: hqp.line
  },
  choice: {
    minHeight: HQP_TOUCH,
    borderRadius: 12,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center'
  },
  pressed: { backgroundColor: hqp.soft2 },
  label: { color: hqp.fg, fontSize: 14, fontWeight: '500', flex: 1 },
  note: { color: hqp.faint, fontFamily: hqp.mono, fontSize: 11 },
  cancel: { backgroundColor: hqp.soft2, justifyContent: 'center', marginTop: 4 },
  cancelLabel: { textAlign: 'center' }
})
