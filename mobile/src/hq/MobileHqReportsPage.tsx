// Custom build (hq-mobile-messenger): HQ's Reports on the phone — the list, one report read in full,
// and a box for the owner's decisions (the keyboard's own dictation works there); Send starts an HQ
// chat in the Mac's window that carries them out.
import { useEffect, useState } from 'react'
import { StyleSheet, Text, TextInput, View } from 'react-native'
import type { HqReport } from '../../../src/shared/hq-reports'
import { MobileMarkdown } from '../components/MobileMarkdown'
import { colors, spacing } from '../theme/mobile-theme'
import { runRpcOperation } from '../transport/rpc-operation'
import type { RpcClient } from '../transport/rpc-client'
import { hqReportDecisions, hqReportsRead, hqWikiPageRead } from './hq-messenger-operations'
import { HqActionButton, hqAgo, hqStyles } from './mobile-hq-parts'
import { errorText, useMobileHqPoll } from './use-mobile-hq-poll'

const FOLDER_LABEL: Record<HqReport['folder'], string> = {
  improvements: 'Week review',
  meetings: 'Meeting',
  'status-update': 'Status update',
  updates: 'Updates',
  daily: 'Day review'
}

async function readReports(client: RpcClient): Promise<{ value: HqReport[] } | { error: string }> {
  const reply = await runRpcOperation(client, hqReportsRead)
  return reply.ok ? { value: reply.reports } : { error: reply.error }
}

function Report({ client, report }: { client: RpcClient; report: HqReport }) {
  const [page, setPage] = useState<{ markdown: string } | { error: string } | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    void runRpcOperation(client, hqWikiPageRead, { path: report.path })
      .then(
        (reply) => live && setPage(reply.ok ? { markdown: reply.markdown } : { error: reply.error })
      )
      .catch((failure: unknown) => live && setPage({ error: errorText(failure) }))
    return () => {
      live = false
    }
  }, [client, report.path])
  const send = (): void => {
    setBusy(true)
    setNotice(null)
    void runRpcOperation(client, hqReportDecisions, { path: report.path, text: text.trim() })
      .then((reply) => {
        setNotice(reply.ok ? 'Sent — an HQ chat on your Mac carries it out.' : reply.error)
        if (reply.ok) {
          setText('')
        }
      })
      .catch((failure: unknown) => setNotice(errorText(failure)))
      .finally(() => setBusy(false))
  }
  return (
    <View style={styles.report}>
      {page === null ? (
        <Text style={hqStyles.meta}>Loading…</Text>
      ) : 'error' in page ? (
        <Text style={hqStyles.error}>{page.error}</Text>
      ) : (
        <MobileMarkdown content={page.markdown.replace(/^---\n[\s\S]*?\n---\n/, '')} />
      )}
      <Text style={hqStyles.section}>Your decisions</Text>
      <TextInput
        style={[hqStyles.input, styles.decisions]}
        multiline
        value={text}
        editable={!busy}
        onChangeText={setText}
        placeholder="«1 yes, 2 no, 3 change to …» — say it or type it"
        placeholderTextColor={colors.textMuted}
        accessibilityLabel="Decisions on this report"
      />
      <View style={hqStyles.actions}>
        <HqActionButton
          label={busy ? 'Sending…' : 'Send decisions'}
          primary
          disabled={busy || !text.trim()}
          onPress={send}
        />
      </View>
      {notice ? <Text style={hqStyles.label}>{notice}</Text> : null}
    </View>
  )
}

export function MobileHqReportsPage({
  client,
  path,
  onOpen
}: {
  client: RpcClient
  /** The report shown, or null for the list. */
  path: string | null
  onOpen: (path: string) => void
}) {
  const { state } = useMobileHqPoll(client, readReports)
  if (state.status === 'loading') {
    return <Text style={hqStyles.meta}>Loading…</Text>
  }
  if (state.status === 'error') {
    return <Text style={hqStyles.error}>{state.message}</Text>
  }
  const shown = path ? state.value.find((report) => report.path === path) : null
  if (shown) {
    return <Report client={client} report={shown} />
  }
  if (state.value.length === 0) {
    return <Text style={hqStyles.meta}>No reports yet.</Text>
  }
  return (
    <View>
      {state.value.map((report) => (
        <View key={report.path} style={hqStyles.row}>
          <Text
            style={hqStyles.title}
            accessibilityRole="button"
            onPress={() => onOpen(report.path)}
            numberOfLines={2}
          >
            {report.title}
          </Text>
          <Text style={hqStyles.meta}>
            {FOLDER_LABEL[report.folder]} · {hqAgo(report.at, state.loadedAt)}
          </Text>
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  report: { gap: spacing.sm },
  decisions: { minHeight: 96, textAlignVertical: 'top' }
})
