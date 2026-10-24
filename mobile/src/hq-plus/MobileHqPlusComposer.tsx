// Custom build (hq-plus-phone): «Write to HQ» at the bottom — the words go to the Ask HQ chat on the
// Mac, as the desktop's command box does; the room it was written in sits right-aligned in the field.
// The mic is the session screen's dictation, with the Mac's Voice Prompts when they are on.
import { useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { ArrowUp, Mic, Square } from 'lucide-react-native'
import { useMobileDictation } from '../hooks/use-mobile-dictation'
import { offerMobileVoicePrompt } from '../hq/mobile-voice-prompt'
import type { RpcClient } from '../transport/rpc-client'
import { appendBufferedDictation } from '../terminal/terminal-live-dictation-routing'
import { askHqFromPhone } from './hq-plus-phone-actions'
import { HQP_TOUCH, hqp } from './hq-plus-phone-theme'

export function MobileHqPlusComposer({
  client,
  roomName,
  bottom,
  onNotice
}: {
  client: RpcClient | null
  roomName: string
  /** The home indicator's inset. */
  bottom: number
  onNotice: (text: string) => void
}) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const dictation = useMobileDictation({
    client,
    enabled: client !== null,
    onTranscript: (said) => {
      void offerMobileVoicePrompt(client, said, (picked) =>
        setText((current) => appendBufferedDictation(current, picked))
      )
    },
    onError: (error) => onNotice(error instanceof Error ? error.message : String(error))
  })
  const send = (): void => {
    if (!client || busy || !text.trim()) {
      return
    }
    setBusy(true)
    void askHqFromPhone(client, text)
      .then((result) => {
        if (result.ok) {
          setText('')
          onNotice('Sent to Ask HQ on the Mac')
        } else {
          onNotice(result.message)
        }
      })
      .finally(() => setBusy(false))
  }
  const mic = (): void => {
    if (dictation.isRecording) {
      void dictation.stop()
    } else if (dictation.isProcessing) {
      void dictation.cancel()
    } else if (!dictation.isStarting) {
      void dictation
        .start()
        .catch((error: unknown) => onNotice(error instanceof Error ? error.message : String(error)))
    }
  }
  const hasText = text.trim().length > 0
  return (
    <View style={[styles.bar, { paddingBottom: bottom + 8 }]}>
      <View style={styles.box}>
        <TextInput
          value={text}
          onChangeText={setText}
          editable={!busy}
          multiline
          placeholder="Write to HQ…"
          placeholderTextColor={hqp.faint}
          accessibilityLabel="Write to HQ"
          style={styles.input}
          testID="hq-plus-composer"
        />
        <Text style={styles.to} numberOfLines={1}>
          → {roomName}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={hasText ? 'Send' : dictation.isRecording ? 'Stop dictation' : 'Dictate'}
        disabled={busy || !client}
        onPress={hasText ? send : mic}
        style={({ pressed }) => [
          styles.round,
          dictation.isRecording && styles.recording,
          (pressed || busy) && styles.pressed
        ]}
      >
        {hasText ? (
          <ArrowUp size={20} color={hqp.ink} strokeWidth={2.2} />
        ) : dictation.isRecording ? (
          <Square size={16} color={hqp.ink} fill={hqp.ink} />
        ) : dictation.isProcessing ? (
          <Text style={styles.roundGlyph}>…</Text>
        ) : (
          <Mic size={20} color={hqp.ink} strokeWidth={2} />
        )}
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingTop: 8,
    paddingHorizontal: 10,
    borderTopWidth: 1,
    borderTopColor: hqp.line,
    backgroundColor: 'rgba(5,10,16,.92)'
  },
  box: {
    flex: 1,
    minHeight: HQP_TOUCH,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: hqp.line2,
    backgroundColor: hqp.card,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 16,
    paddingRight: 12,
    gap: 6
  },
  input: {
    flex: 1,
    minWidth: 0,
    maxHeight: 120,
    color: hqp.fg,
    fontSize: 14.5,
    paddingVertical: 11
  },
  to: { flexShrink: 0, maxWidth: 120, color: hqp.faint, fontFamily: hqp.mono, fontSize: 10.5 },
  round: {
    width: HQP_TOUCH,
    height: HQP_TOUCH,
    borderRadius: HQP_TOUCH / 2,
    backgroundColor: hqp.ice,
    alignItems: 'center',
    justifyContent: 'center'
  },
  recording: { backgroundColor: hqp.red },
  pressed: { opacity: 0.6 },
  roundGlyph: { color: hqp.ink, fontSize: 18 }
})
