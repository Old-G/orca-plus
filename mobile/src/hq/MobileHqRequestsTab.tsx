// Custom build (hq-mobile): the requests to the owner from Slack and ClickUp with their answers, then
// what was done for him this week, with Bring back on a skip.
import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import type { HqSlackScoutDone } from '../../../src/shared/hq-slack-scout'
import { runRpcOperation } from '../transport/rpc-operation'
import type { RpcClient } from '../transport/rpc-client'
import { hqRequestRestore } from './hq-operations'
import { hqAgo, hqStyles } from './mobile-hq-parts'
import { MobileHqRequestCard } from './MobileHqRequestCard'
import { errorText, useMobileHqRequests } from './use-mobile-hq-requests'

const DONE_LABEL: Record<HqSlackScoutDone['decision'], string> = {
  created: 'Task created',
  taken: 'Task taken',
  answered: 'Replied',
  rejected: 'Skipped'
}

function DoneRow({
  client,
  entry,
  now,
  onRestored
}: {
  client: RpcClient
  entry: HqSlackScoutDone
  now: number
  onRestored: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const restore = (): void => {
    void runRpcOperation(client, hqRequestRestore, { id: entry.id })
      .then((reply) => (reply.ok ? onRestored() : setError(reply.error)))
      .catch((failure: unknown) => setError(errorText(failure)))
  }
  return (
    <View style={hqStyles.row}>
      <View style={hqStyles.line}>
        <Text style={hqStyles.label}>{DONE_LABEL[entry.decision]}</Text>
        <Text style={hqStyles.title} numberOfLines={2}>
          {entry.title || entry.id}
        </Text>
        <Text style={hqStyles.meta}>{hqAgo(entry.at, now)}</Text>
      </View>
      {entry.author ? <Text style={hqStyles.meta}>{entry.author}</Text> : null}
      {entry.decision === 'rejected' ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Bring back" onPress={restore}>
          <Text style={hqStyles.link}>Bring back</Text>
        </Pressable>
      ) : null}
      {error ? <Text style={hqStyles.error}>{error}</Text> : null}
    </View>
  )
}

export function MobileHqRequestsTab({
  client,
  onNotice,
  show = 'both'
}: {
  client: RpcClient
  onNotice: (notice: string | null) => void
  /** Custom build (hq-mobile-messenger): Today shows the requests, Done for you the journal. */
  show?: 'requests' | 'done' | 'both'
}) {
  const { state, refresh } = useMobileHqRequests(client)
  if (state.status === 'loading') {
    return <Text style={hqStyles.meta}>Loading…</Text>
  }
  if (state.status === 'error') {
    return <Text style={hqStyles.error}>{state.message}</Text>
  }
  const { drafts, done } = state.value
  const requests =
    show !== 'done' ? (
      <>
        <Text style={hqStyles.section}>Needs you · {drafts.length}</Text>
        {drafts.length === 0 ? (
          <Text style={hqStyles.meta}>Nothing needs you right now.</Text>
        ) : (
          drafts.map((request) => (
            <MobileHqRequestCard
              key={request.id}
              client={client}
              request={request}
              onDone={(next) => {
                onNotice(next)
                refresh()
              }}
            />
          ))
        )}
      </>
    ) : null
  if (show === 'requests') {
    return requests
  }
  return (
    <>
      {requests}
      <Text style={hqStyles.section}>Done for you</Text>
      {done.length === 0 ? (
        <Text style={hqStyles.meta}>Nothing done for you yet this week.</Text>
      ) : (
        <View style={hqStyles.list}>
          {done.map((entry) => (
            <DoneRow
              key={entry.id}
              client={client}
              entry={entry}
              now={state.loadedAt}
              onRestored={() => {
                onNotice('The request is back.')
                refresh()
              }}
            />
          ))}
        </View>
      )}
    </>
  )
}
