// Custom build (hq-mobile): HQ's «Notes» on the phone — one line to jot «@Вера жду выгрузку до пт»,
// read the same way the Mac reads it, then who waits on whom and the plain notes; a tick closes one.
import { useState } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'
import { HQ_NOTE_SOURCE, parseHqNote, type HqParsedNote } from '../../../src/shared/hq-note-parse'
import {
  findPersonByName,
  type HqPulse,
  type HqWaiting
} from '../../../src/shared/hq-pulse-snapshot'
import { runRpcOperation } from '../transport/rpc-operation'
import type { RpcClient } from '../transport/rpc-client'
import { hqPersonUpsert, hqPulseRead, hqWaitingAdd, hqWaitingClose } from './hq-operations'
import { HqActionButton, hqStyles } from './mobile-hq-parts'
import { errorText, useMobileHqPoll } from './use-mobile-hq-poll'
import { ALL_HQ_SPACES, mobileHqShows, type MobileHqSpaceFilter } from './mobile-hq-spaces'

async function readPulse(client: RpcClient): Promise<{ value: HqPulse }> {
  return { value: await runRpcOperation(client, hqPulseRead) }
}

function previewLine(note: HqParsedNote): string {
  const who = note.personName
    ? note.direction === 'on-them'
      ? `waiting on ${note.personName}`
      : `${note.personName} waits on you`
    : 'a note'
  const due = note.dueAt ? ` · by ${new Date(note.dueAt).toLocaleDateString()}` : ''
  return `${who}: ${note.title}${due}`
}

async function personIdFor(
  client: RpcClient,
  pulse: HqPulse,
  name: string | null
): Promise<string | null> {
  const trimmed = name?.trim()
  if (!trimmed) {
    return null
  }
  return (
    findPersonByName(pulse.people, trimmed)?.id ??
    (await runRpcOperation(client, hqPersonUpsert, { name: trimmed })).id
  )
}

function NoteInput({
  client,
  pulse,
  onAdded
}: {
  client: RpcClient
  pulse: HqPulse
  onAdded: () => void
}) {
  const [text, setText] = useState('')
  const [preview, setPreview] = useState<HqParsedNote | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const change = (next: string): void => {
    setText(next)
    setPreview(next.trim() ? parseHqNote(next, Date.now()) : null)
  }
  const add = async (): Promise<void> => {
    if (!preview) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      const personId = await personIdFor(client, pulse, preview.personName)
      await runRpcOperation(client, hqWaitingAdd, {
        direction: preview.direction ?? 'on-me',
        title: preview.title,
        source: preview.direction ? 'manual' : HQ_NOTE_SOURCE,
        ...(personId ? { personId } : {}),
        ...(preview.dueAt ? { dueAt: preview.dueAt } : {})
      })
      change('')
      onAdded()
    } catch (failure) {
      setError(errorText(failure))
    } finally {
      setBusy(false)
    }
  }
  return (
    <View style={hqStyles.card}>
      <TextInput
        value={text}
        editable={!busy}
        onChangeText={change}
        onSubmitEditing={() => void add()}
        placeholder="+ Note… «@Вера жду выгрузку до пт»"
        placeholderTextColor={hqStyles.meta.color}
        accessibilityLabel="New note"
        style={hqStyles.input}
      />
      {preview ? <Text style={hqStyles.meta}>{previewLine(preview)}</Text> : null}
      <View style={hqStyles.actions}>
        <HqActionButton
          label="Add"
          primary
          disabled={busy || !preview}
          onPress={() => void add()}
        />
      </View>
      {error ? <Text style={hqStyles.error}>{error}</Text> : null}
    </View>
  )
}

function NoteRow({
  client,
  waiting,
  personName,
  onClosed
}: {
  client: RpcClient
  waiting: HqWaiting
  personName: string | null
  onClosed: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const close = (): void => {
    void runRpcOperation(client, hqWaitingClose, { id: waiting.id, status: 'resolved' })
      .then(onClosed)
      .catch((failure: unknown) => setError(errorText(failure)))
  }
  return (
    <View style={hqStyles.row}>
      <View style={hqStyles.line}>
        <Pressable accessibilityRole="button" accessibilityLabel="Done" onPress={close}>
          <Text style={hqStyles.link}>○</Text>
        </Pressable>
        <Text style={hqStyles.title}>{waiting.title}</Text>
      </View>
      {personName || waiting.dueAt ? (
        <Text style={hqStyles.meta}>
          {[personName, waiting.dueAt ? `by ${new Date(waiting.dueAt).toLocaleDateString()}` : null]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      ) : null}
      {error ? <Text style={hqStyles.error}>{error}</Text> : null}
    </View>
  )
}

export function MobileHqNotesTab({
  client,
  spaces = ALL_HQ_SPACES
}: {
  client: RpcClient
  spaces?: MobileHqSpaceFilter
}) {
  const { state, refresh } = useMobileHqPoll(client, readPulse)
  if (state.status === 'loading') {
    return <Text style={hqStyles.meta}>Loading…</Text>
  }
  if (state.status === 'error') {
    return <Text style={hqStyles.error}>{state.message}</Text>
  }
  // Custom build (hq-spaces): only the chosen workspace's notes.
  const pulse = {
    ...state.value,
    waitings: state.value.waitings.filter((waiting) =>
      mobileHqShows(spaces, { project: waiting.project })
    )
  }
  const names = new Map(pulse.people.map((person) => [person.id, person.name]))
  const sections: { title: string; empty: string; rows: HqWaiting[] }[] = [
    {
      title: 'Waiting on me',
      empty: 'Nobody is waiting on you.',
      rows: pulse.waitings.filter((w) => w.direction === 'on-me' && w.source !== HQ_NOTE_SOURCE)
    },
    {
      title: "I'm waiting on",
      empty: "You're not waiting on anyone.",
      rows: pulse.waitings.filter((w) => w.direction === 'on-them' && w.source !== HQ_NOTE_SOURCE)
    },
    {
      title: 'Just notes',
      empty: 'No notes.',
      rows: pulse.waitings.filter((w) => w.source === HQ_NOTE_SOURCE)
    }
  ]
  return (
    <>
      <NoteInput client={client} pulse={pulse} onAdded={refresh} />
      {sections.map((section) => (
        <View key={section.title} style={hqStyles.stack}>
          <Text style={hqStyles.section}>
            {section.title} · {section.rows.length}
          </Text>
          {section.rows.length === 0 ? (
            <Text style={hqStyles.meta}>{section.empty}</Text>
          ) : (
            <View style={hqStyles.list}>
              {section.rows.map((waiting) => (
                <NoteRow
                  key={waiting.id}
                  client={client}
                  waiting={waiting}
                  personName={waiting.personId ? (names.get(waiting.personId) ?? null) : null}
                  onClosed={refresh}
                />
              ))}
            </View>
          )}
        </View>
      ))}
    </>
  )
}
