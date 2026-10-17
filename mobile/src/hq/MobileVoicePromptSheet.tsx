// Custom build (hq-voice-prompts): the phone's voice prompt — pick what the dictation becomes (as said,
// for an agent, for a person, a ClickUp task, an idea), let the Mac's Claude rewrite it, edit, then
// insert it into the composer. Nothing is sent; a ClickUp task is created only on Create.
import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import {
  HQ_VOICE_MODES,
  detectHqVoiceMode,
  type HqVoiceMode
} from '../../../src/shared/hq-voice-prompts'
import { BottomDrawer } from '../components/BottomDrawer'
import { runRpcOperation } from '../transport/rpc-operation'
import type { RpcClient } from '../transport/rpc-client'
import { colors, radii, spacing, typography } from '../theme/mobile-theme'
import { hqVoiceIdea, hqVoiceRewrite, hqVoiceTask } from './hq-operations'
import { HqActionButton, hqStyles } from './mobile-hq-parts'
import {
  closeMobileVoicePrompt,
  useMobileVoicePrompt,
  type MobileVoicePrompt
} from './mobile-voice-prompt'
import { errorText } from './use-mobile-hq-requests'

const MODE_LABELS: Record<HqVoiceMode, string> = {
  raw: 'As said',
  agent: 'For an agent',
  person: 'For a person',
  clickup: 'ClickUp task',
  idea: 'Idea'
}

type ModeText =
  | { status: 'ready'; text: string }
  | { status: 'busy' }
  | { status: 'error'; message: string }

function PromptBody({
  client,
  prompt,
  showToast
}: {
  client: RpcClient
  prompt: MobileVoicePrompt
  showToast: (message: string) => void
}) {
  const [detected] = useState(() => detectHqVoiceMode(prompt.text))
  const [mode, setMode] = useState<HqVoiceMode>(detected.mode ?? 'raw')
  const [texts, setTexts] = useState<Partial<Record<HqVoiceMode, ModeText>>>(() => ({
    raw: { status: 'ready', text: prompt.text }
  }))
  const [saving, setSaving] = useState(false)
  const shown = texts[mode]

  useEffect(() => {
    if (mode === 'raw' || texts[mode]) {
      return
    }
    setTexts((current) => ({ ...current, [mode]: { status: 'busy' } }))
    void runRpcOperation(client, hqVoiceRewrite, { mode, text: detected.text || prompt.text })
      .catch((failure: unknown) => ({ ok: false as const, error: errorText(failure) }))
      .then((reply) =>
        setTexts((current) => ({
          ...current,
          [mode]: reply.ok
            ? { status: 'ready', text: reply.text }
            : { status: 'error', message: reply.error }
        }))
      )
  }, [client, mode, texts, detected.text, prompt.text])

  const text = shown?.status === 'ready' ? shown.text : ''
  const setText = (next: string): void =>
    setTexts((current) => ({ ...current, [mode]: { status: 'ready', text: next } }))

  const file = async (kind: 'idea' | 'task'): Promise<void> => {
    setSaving(true)
    const reply = await (
      kind === 'idea'
        ? runRpcOperation(client, hqVoiceIdea, { text })
        : runRpcOperation(client, hqVoiceTask, { text })
    ).catch((failure: unknown) => ({ ok: false as const, error: errorText(failure) }))
    setSaving(false)
    if (!reply.ok) {
      showToast(reply.error)
      return
    }
    showToast(kind === 'idea' ? 'Saved to HQ ideas' : 'Task created in ClickUp')
    closeMobileVoicePrompt()
  }

  return (
    <View style={styles.body}>
      <Text style={styles.title}>Voice prompt</Text>
      <View style={styles.modes} accessibilityRole="radiogroup">
        {HQ_VOICE_MODES.map((entry) => (
          <Pressable
            key={entry}
            accessibilityRole="radio"
            accessibilityState={{ checked: entry === mode }}
            accessibilityLabel={MODE_LABELS[entry]}
            onPress={() => setMode(entry)}
            style={[styles.mode, entry === mode && styles.modeOn]}
          >
            <Text style={[styles.modeLabel, entry === mode && styles.modeLabelOn]}>
              {MODE_LABELS[entry]}
            </Text>
          </Pressable>
        ))}
      </View>
      {shown?.status === 'busy' ? (
        <Text style={hqStyles.meta}>Claude is rewriting it…</Text>
      ) : shown?.status === 'error' ? (
        <Text style={hqStyles.error}>{shown.message}</Text>
      ) : (
        <TextInput
          multiline
          value={text}
          onChangeText={setText}
          accessibilityLabel="Text to insert"
          placeholderTextColor={colors.textMuted}
          style={[hqStyles.input, styles.input]}
        />
      )}
      <View style={hqStyles.actions}>
        <HqActionButton
          primary
          label="Insert"
          disabled={!text}
          onPress={() => {
            closeMobileVoicePrompt()
            prompt.insert(text)
          }}
        />
        {mode === 'clickup' ? (
          <HqActionButton
            label={saving ? 'Creating…' : 'Create in ClickUp'}
            disabled={!text || saving}
            onPress={() => void file('task')}
          />
        ) : null}
        {mode === 'idea' ? (
          <HqActionButton
            label="Save to HQ ideas"
            disabled={!text || saving}
            onPress={() => void file('idea')}
          />
        ) : null}
        <HqActionButton label="Discard" onPress={closeMobileVoicePrompt} />
      </View>
    </View>
  )
}

export function MobileVoicePromptSheet({
  client,
  showToast
}: {
  client: RpcClient | null
  showToast: (message: string) => void
}) {
  const prompt = useMobileVoicePrompt()
  return (
    <BottomDrawer visible={prompt !== null && client !== null} onClose={closeMobileVoicePrompt}>
      {prompt && client ? (
        <PromptBody key={prompt.text} client={client} prompt={prompt} showToast={showToast} />
      ) : null}
    </BottomDrawer>
  )
}

const styles = StyleSheet.create({
  body: { gap: spacing.md, paddingHorizontal: spacing.xs },
  title: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  modes: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  mode: {
    borderRadius: radii.button,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm
  },
  modeOn: { backgroundColor: colors.bgRaised, borderColor: colors.textMuted },
  modeLabel: { fontSize: typography.metaSize, color: colors.textSecondary },
  modeLabelOn: { color: colors.textPrimary, fontWeight: '600' },
  input: { minHeight: 140, maxHeight: 320, textAlignVertical: 'top' }
})
