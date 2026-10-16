// Custom build (hq-mobile): the bell on the phone — what finished, what is stuck, what asks for the
// owner — with each item's own buttons, pressed in the Mac's window. Approvals stay on the Mac.
import { useState } from 'react'
import { Text, View } from 'react-native'
import { readHqInbox, type HqInboxItem } from '../../../src/shared/hq-requests-reply'
import { OUTGOING_APPROVAL_BELL_KIND } from '../../../src/shared/outgoing-approval/outgoing-approval-bell'
import { runRpcOperation } from '../transport/rpc-operation'
import type { RpcClient } from '../transport/rpc-client'
import { hqBellActionOnDesktop, hqInboxMarkRead, hqInboxRead } from './hq-operations'
import { HqActionButton, hqAgo, hqStyles } from './mobile-hq-parts'
import { errorText, useMobileHqPoll } from './use-mobile-hq-poll'

async function readInbox(client: RpcClient): Promise<{ value: HqInboxItem[] }> {
  return { value: readHqInbox(await runRpcOperation(client, hqInboxRead)) }
}

function InboxCard({
  client,
  item,
  now,
  onChanged
}: {
  client: RpcClient
  item: HqInboxItem
  now: number
  onChanged: (notice: string | null) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isApproval = item.kind === OUTGOING_APPROVAL_BELL_KIND
  const press = async (actionId: string, label: string): Promise<void> => {
    setBusy(true)
    setError(null)
    const reply = await runRpcOperation(client, hqBellActionOnDesktop, {
      itemId: item.id,
      actionId
    }).catch((failure: unknown) => ({ ok: false as const, error: errorText(failure) }))
    setBusy(false)
    if (reply.ok) {
      onChanged(`«${label}» ran on your Mac.`)
    } else {
      setError(reply.error)
    }
  }
  const markRead = (): void => {
    void runRpcOperation(client, hqInboxMarkRead, { id: item.id })
      .then(() => onChanged(null))
      .catch((failure: unknown) => setError(errorText(failure)))
  }
  return (
    <View style={hqStyles.card} testID="mobile-hq-inbox-item">
      <View style={hqStyles.line}>
        <Text style={hqStyles.title} numberOfLines={2}>
          {item.readAt === null ? '● ' : ''}
          {item.title}
        </Text>
        <Text style={hqStyles.meta}>{hqAgo(item.createdAt, now)}</Text>
      </View>
      {item.body ? (
        <Text style={hqStyles.meta} numberOfLines={3}>
          {item.body}
        </Text>
      ) : null}
      {isApproval ? (
        <Text style={hqStyles.label}>Approve this on your Mac.</Text>
      ) : (
        <View style={hqStyles.actions}>
          {item.actions.map((action, index) => (
            <HqActionButton
              key={action.id}
              label={action.label}
              primary={index === 0}
              disabled={busy}
              onPress={() => void press(action.id, action.label)}
            />
          ))}
          {item.readAt === null ? (
            <HqActionButton label="Mark read" disabled={busy} onPress={markRead} />
          ) : null}
        </View>
      )}
      {error ? <Text style={hqStyles.error}>{error}</Text> : null}
    </View>
  )
}

export function MobileHqInboxTab({
  client,
  onNotice
}: {
  client: RpcClient
  onNotice: (notice: string | null) => void
}) {
  const { state, refresh } = useMobileHqPoll(client, readInbox)
  if (state.status === 'loading') {
    return <Text style={hqStyles.meta}>Loading…</Text>
  }
  if (state.status === 'error') {
    return <Text style={hqStyles.error}>{state.message}</Text>
  }
  if (state.value.length === 0) {
    return <Text style={hqStyles.meta}>The bell is empty.</Text>
  }
  return (
    <>
      {state.value.map((item) => (
        <InboxCard
          key={item.id}
          client={client}
          item={item}
          now={state.loadedAt}
          onChanged={(notice) => {
            onNotice(notice)
            refresh()
          }}
        />
      ))}
    </>
  )
}
