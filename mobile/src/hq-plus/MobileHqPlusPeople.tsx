// Custom build (hq-closed-loop): People on the phone, as on the desktop's right — the people the
// owner works with (or everyone, by search) and one person's dossier; «Write», «Before a meeting» and
// «Fill in» go to the Ask HQ chat on the Mac, so messages still wait for Approve there.
import { useCallback, useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import {
  hqDossierGaps,
  hqFillDossierPrompt,
  hqMeetingPrepPrompt,
  hqPersonChannelLine,
  hqPlusPeopleList,
  hqWritePersonPrompt,
  isHqPlusPersonOfMine,
  type HqPeopleRow,
  type HqPersonCard,
  type HqPersonCardItem
} from '../../../src/shared/hq-people'
import { useMobileHqPoll } from '../hq/use-mobile-hq-poll'
import { runRpcOperation } from '../transport/rpc-operation'
import type { RpcClient } from '../transport/rpc-client'
import { askHqFromPhone } from './hq-plus-phone-actions'
import { hqPlusPersonRead } from './hq-plus-phone-operations'
import { HQP_TOUCH, hqp, hqpStyles } from './hq-plus-phone-theme'
import { HqpButton, HqpButtons, HqpTile } from './mobile-hq-plus-parts'

const ITEMS_MAX = 4
const NOTES_MAX = 10

function waitsLabel(row: HqPeopleRow): string {
  if (row.onThem > 0) {
    return `we wait · ${row.onThem}`
  }
  return row.onMe > 0 ? `waits on you · ${row.onMe}` : ''
}

export function MobileHqPlusPeople({
  client,
  people,
  error
}: {
  client: RpcClient | null
  people: readonly HqPeopleRow[]
  error: string | null
}) {
  const [query, setQuery] = useState('')
  const [mine, setMine] = useState(true)
  const [picked, setPicked] = useState<string | null>(null)
  const row = picked ? (people.find((entry) => entry.key === picked) ?? null) : null
  if (row) {
    return <Dossier client={client} row={row} onBack={() => setPicked(null)} />
  }
  const shown = hqPlusPeopleList(people, { mine, query })
  return (
    <>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Name, @slack, project…"
        placeholderTextColor={hqp.faint}
        accessibilityLabel="Search people"
        style={styles.search}
      />
      <View style={styles.chips}>
        <Chip
          label={`You work with · ${people.filter(isHqPlusPersonOfMine).length}`}
          on={mine}
          onPress={() => setMine(true)}
        />
        <Chip label={`All · ${people.length}`} on={!mine} onPress={() => setMine(false)} />
      </View>
      {error ? <Text style={hqpStyles.error}>{error}</Text> : null}
      {shown.length === 0 ? <Text style={styles.none}>Nobody matches.</Text> : null}
      {shown.map((entry) => (
        <Pressable
          key={entry.key}
          accessibilityRole="button"
          onPress={() => setPicked(entry.key)}
          style={({ pressed }) => [styles.row, pressed && hqpStyles.pressed]}
        >
          <HqpTile name={entry.name} />
          <View style={styles.rowBody}>
            <Text style={styles.rowTitle} numberOfLines={1}>
              {entry.name}
            </Text>
            <Text style={styles.rowMeta} numberOfLines={1}>
              {[entry.jobTitle, ...(entry.projects ?? []).map((p) => p.slug)]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </View>
          <Text style={styles.wait}>{waitsLabel(entry)}</Text>
        </Pressable>
      ))}
    </>
  )
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={[styles.chip, on && styles.chipOn]}
    >
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  )
}

function Field({ label, children }: { label: string; children: string | null }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue}>{children || '—'}</Text>
    </View>
  )
}

function itemsText(items: readonly HqPersonCardItem[]): string | null {
  return items.length === 0
    ? null
    : items
        .slice(0, ITEMS_MAX)
        .map((entry) => `${entry.title}${entry.project ? ` · ${entry.project}` : ''}`)
        .join('\n')
}

function Dossier({
  client,
  row,
  onBack
}: {
  client: RpcClient | null
  row: HqPeopleRow
  onBack: () => void
}) {
  const read = useCallback(
    async (rpc: RpcClient): Promise<{ value: HqPersonCard } | { error: string }> => {
      try {
        const reply = await runRpcOperation(rpc, hqPlusPersonRead, { key: row.key })
        return reply.ok ? { value: reply } : { error: reply.error }
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) }
      }
    },
    [row.key]
  )
  const card = useMobileHqPoll(client, read).state
  const ready = card.status === 'ready' ? card.value : null
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const gaps = hqDossierGaps(row)
  const ask = (prompt: string): void => {
    if (!client || busy) {
      return
    }
    setBusy(true)
    void askHqFromPhone(client, prompt).then((result) => {
      setBusy(false)
      setNote(result.ok ? 'Sent to the Ask HQ chat on the Mac.' : result.message)
    })
  }
  const notes = (ready?.notes ?? '').split('\n').filter((line) => line.trim())
  const ids = [
    row.slackHandle ? `@${row.slackHandle}` : null,
    row.slackUserId,
    row.email,
    row.clickupUserId ? `ClickUp ${row.clickupUserId}` : null
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <>
      <Pressable accessibilityRole="button" onPress={onBack} style={styles.back}>
        <Text style={hqpStyles.link}>‹ People</Text>
      </Pressable>
      <View style={styles.dossier}>
        <View style={styles.who}>
          <HqpTile name={row.name} />
          <View style={styles.rowBody}>
            <Text style={styles.name}>{row.name}</Text>
            <Text style={styles.rowMeta}>
              {[row.orgName !== row.name ? row.orgName : null, row.jobTitle, row.department]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </View>
        </View>
        {gaps.length > 0 ? (
          <Text style={styles.gap}>
            The dossier does not say{' '}
            {gaps
              .map((gap) => (gap === 'projects' ? 'their projects' : 'where to write them'))
              .join(', ')}{' '}
            yet; «Fill in» asks you only that.
          </Text>
        ) : null}
        <Field label="PROJECTS">
          {(row.projects ?? [])
            .map((entry) => (entry.role ? `${entry.slug} (${entry.role})` : entry.slug))
            .join(' · ') || null}
        </Field>
        <Field label="DECIDES">{(row.decides ?? []).join('; ') || null}</Field>
        <Field label="WRITE">{hqPersonChannelLine(row.channel)}</Field>
        <Field label="IDS">{ids || null}</Field>
        {ready ? (
          <>
            <Field label="WE WAIT ON THEM">{itemsText(ready.onThem)}</Field>
            <Field label="THEY WAIT ON US">{itemsText(ready.onMe)}</Field>
            <Field label="SENT VIA APPROVE">{itemsText(ready.sent)}</Field>
          </>
        ) : null}
        {notes.length > 0 ? (
          <Text style={styles.notes}>
            {notes
              .slice(0, NOTES_MAX)
              .map((line) => line.replace(/\*\*/g, ''))
              .join('\n')}
          </Text>
        ) : null}
        <HqpButtons>
          <HqpButton
            label="Write"
            main
            disabled={busy || !client}
            onPress={() => ask(hqWritePersonPrompt(row))}
          />
          <HqpButton
            label="Before a meeting"
            disabled={busy || !client}
            onPress={() => ask(hqMeetingPrepPrompt(row))}
          />
          {gaps.length > 0 ? (
            <HqpButton
              label="Fill in"
              ghost
              disabled={busy || !client}
              onPress={() => ask(hqFillDossierPrompt(row))}
            />
          ) : null}
        </HqpButtons>
        {note ? <Text style={hqpStyles.hint}>{note}</Text> : null}
      </View>
    </>
  )
}

const styles = StyleSheet.create({
  search: {
    minHeight: HQP_TOUCH,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: hqp.line2,
    backgroundColor: hqp.card,
    color: hqp.fg,
    paddingHorizontal: 14,
    fontSize: 15
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: hqp.line,
    justifyContent: 'center'
  },
  chipOn: { backgroundColor: hqp.soft2, borderColor: hqp.line2 },
  chipText: { color: hqp.mute, fontSize: 12.5 },
  chipTextOn: { color: hqp.fg },
  none: { color: hqp.faint, fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52 },
  rowBody: { flex: 1, minWidth: 0 },
  rowTitle: { color: hqp.fg, fontSize: 14, fontWeight: '600' },
  rowMeta: { color: hqp.faint, fontSize: 12 },
  wait: { color: hqp.amber, fontFamily: hqp.mono, fontSize: 10.5 },
  back: { minHeight: HQP_TOUCH, justifyContent: 'center' },
  dossier: {
    borderWidth: 1,
    borderColor: hqp.line2,
    borderRadius: 14,
    backgroundColor: hqp.card,
    padding: 14,
    gap: 10
  },
  who: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  name: { color: hqp.fg, fontSize: 17, fontWeight: '600' },
  gap: { color: hqp.amber, fontSize: 13 },
  field: { gap: 2 },
  fieldLabel: { color: hqp.faint, fontFamily: hqp.mono, fontSize: 10, letterSpacing: 1.2 },
  fieldValue: { color: hqp.fg, fontSize: 13.5, lineHeight: 19 },
  notes: { color: hqp.mute, fontSize: 12.5, lineHeight: 18 }
})
