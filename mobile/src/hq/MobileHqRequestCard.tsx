// Custom build (hq-mobile): one request to the owner on the phone — who asks what — with Do, Just
// reply and Skip. A ClickUp comment gets its reply composer here; the rest runs on the Mac.
import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { hqSlackRequestKind, type HqSlackScoutDraft } from '../../../src/shared/hq-slack-scout'
import { runRpcOperation } from '../transport/rpc-operation'
import type { RpcClient } from '../transport/rpc-client'
import { colors, radii, spacing, typography } from '../theme/mobile-theme'
import {
  hqClickUpReplyDraft,
  hqClickUpReplySend,
  hqRequestOnDesktop,
  hqRequestSkip
} from './hq-operations'
import { errorText } from './use-mobile-hq-requests'

const KIND_LABEL = { do: 'Do', answer: 'Reply', fyi: 'FYI' } as const

function ActionButton({
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
        styles.button,
        primary && styles.buttonPrimary,
        (pressed || disabled) && styles.pressed
      ]}
    >
      <Text style={[styles.buttonLabel, primary && styles.buttonLabelPrimary]}>{label}</Text>
    </Pressable>
  )
}

function ClickUpReplyComposer({
  client,
  id,
  onSent,
  onCancel
}: {
  client: RpcClient
  id: string
  onSent: () => void
  onCancel: () => void
}) {
  const [phase, setPhase] = useState<'drafting' | 'ready' | 'sending'>('drafting')
  const [draft, setDraft] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    void runRpcOperation(client, hqClickUpReplyDraft, { id })
      .then((reply) => {
        if (!live) {
          return
        }
        if (reply.ok) {
          setDraft(reply.text)
          setText(reply.text)
        } else {
          setError(reply.error)
        }
      })
      .catch((failure: unknown) => live && setError(errorText(failure)))
      .finally(() => live && setPhase('ready'))
    return () => {
      live = false
    }
  }, [client, id])
  const send = async (): Promise<void> => {
    setPhase('sending')
    setError(null)
    const reply = await runRpcOperation(client, hqClickUpReplySend, {
      id,
      text: text.trim(),
      ...(draft ? { draft } : {})
    }).catch((failure: unknown) => ({ ok: false as const, error: errorText(failure) }))
    if (reply.ok) {
      onSent()
      return
    }
    setPhase('ready')
    setError(reply.error)
  }
  const busy = phase !== 'ready'
  return (
    <View style={styles.composer}>
      <TextInput
        multiline
        editable={!busy}
        value={text}
        onChangeText={setText}
        placeholder={phase === 'drafting' ? 'Drafting the reply…' : 'Your reply'}
        placeholderTextColor={colors.textMuted}
        accessibilityLabel="Reply in ClickUp"
        style={styles.input}
      />
      <View style={styles.actions}>
        <ActionButton
          primary
          label={phase === 'sending' ? 'Sending…' : 'Send'}
          disabled={busy || !text.trim()}
          onPress={() => void send()}
        />
        <ActionButton label="Cancel" disabled={phase === 'sending'} onPress={onCancel} />
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  )
}

export function MobileHqRequestCard({
  client,
  request,
  onDone
}: {
  client: RpcClient
  request: HqSlackScoutDraft
  /** The request was decided or handed to the Mac; the list reloads. */
  onDone: (notice: string | null) => void
}) {
  const [replying, setReplying] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const kind = hqSlackRequestKind(request)
  const isClickUp = request.source === 'clickup'

  const run = async (
    write: () => Promise<{ ok: true } | { ok: false; error: string }>,
    notice: string | null
  ): Promise<void> => {
    setBusy(true)
    setError(null)
    const reply = await write().catch((failure: unknown) => ({
      ok: false as const,
      error: errorText(failure)
    }))
    setBusy(false)
    if (reply.ok) {
      onDone(notice)
    } else {
      setError(reply.error)
    }
  }
  const onDesktop = (action: 'do' | 'answer', notice: string) =>
    void run(() => runRpcOperation(client, hqRequestOnDesktop, { id: request.id, action }), notice)
  const skip = () =>
    void run(() => runRpcOperation(client, hqRequestSkip, { id: request.id }), null)

  return (
    <View style={styles.card} testID="mobile-hq-request">
      <View style={styles.headline}>
        <Text style={styles.kind}>{KIND_LABEL[kind]}</Text>
        <Text style={styles.ask} numberOfLines={3}>
          {request.author ? <Text style={styles.author}>{request.author}: </Text> : null}
          {request.ask || request.title}
        </Text>
      </View>
      <Text style={styles.meta} numberOfLines={1}>
        {[request.project ?? 'project?', request.channelName].filter(Boolean).join(' · ')}
      </Text>
      {replying && isClickUp ? (
        <ClickUpReplyComposer
          client={client}
          id={request.id}
          onSent={() => onDone('Reply posted in ClickUp.')}
          onCancel={() => setReplying(false)}
        />
      ) : (
        <View style={styles.actions}>
          <ActionButton
            primary={kind !== 'answer'}
            label="Do"
            disabled={busy}
            onPress={() => onDesktop('do', 'Started on your Mac: the task and Claude.')}
          />
          <ActionButton
            primary={kind === 'answer'}
            label="Just reply"
            disabled={busy}
            onPress={() =>
              isClickUp
                ? setReplying(true)
                : onDesktop('answer', 'Claude is drafting the reply on your Mac; approve it there.')
            }
          />
          <ActionButton label={kind === 'fyi' ? 'Got it' : 'Skip'} disabled={busy} onPress={skip} />
        </View>
      )}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.bgPanel,
    borderRadius: radii.card,
    padding: spacing.md,
    gap: spacing.sm
  },
  headline: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  kind: {
    fontSize: typography.metaSize,
    color: colors.textSecondary,
    backgroundColor: colors.bgRaised,
    borderRadius: radii.button,
    paddingHorizontal: spacing.xs + 2,
    paddingVertical: 2,
    overflow: 'hidden'
  },
  ask: { flex: 1, fontSize: typography.bodySize, color: colors.textPrimary },
  author: { fontWeight: '600' },
  meta: { fontSize: typography.metaSize, color: colors.textMuted },
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
  composer: { gap: spacing.sm },
  input: {
    minHeight: 96,
    backgroundColor: colors.bgRaised,
    borderRadius: radii.input,
    padding: spacing.sm,
    color: colors.textPrimary,
    fontSize: typography.bodySize,
    textAlignVertical: 'top'
  },
  error: { fontSize: typography.metaSize, color: colors.statusRed }
})
