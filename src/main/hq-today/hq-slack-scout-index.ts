// Custom build (outgoing-approval-target): what the Slack scout learned about conversations — a
// channel's name and who started a thread with what — so an approval card can name a DM the Orca+ bot
// cannot see. Draft ids are `<channel id>:<thread ts>`.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  HQ_SLACK_SCOUT_DECISIONS_FILE,
  HQ_SLACK_SCOUT_DIR,
  HQ_SLACK_SCOUT_DRAFTS_FILE,
  parseHqSlackScoutDecisions,
  parseHqSlackScoutDrafts
} from '../../shared/hq-slack-scout'

export type HqSlackScoutThread = { author: string | null; said: string | null }

export type HqSlackScoutIndex = {
  channelNames: ReadonlyMap<string, string>
  /** By `<channel id>:<thread ts>`. */
  threads: ReadonlyMap<string, HqSlackScoutThread>
}

function text(value: string | null | undefined): string | null {
  return value?.trim() ? value.trim() : null
}

export function indexHqSlackScout(drafts: string, decisions: string): HqSlackScoutIndex {
  const channelNames = new Map<string, string>()
  const threads = new Map<string, HqSlackScoutThread>()
  for (const [id, decision] of Object.entries(parseHqSlackScoutDecisions(decisions))) {
    threads.set(id, { author: text(decision.author), said: text(decision.title) })
  }
  for (const draft of parseHqSlackScoutDrafts(drafts).drafts) {
    const channelId = draft.id.split(':')[0]
    const channelName = text(draft.channelName)
    if (channelId && channelName) {
      channelNames.set(channelId, channelName)
    }
    threads.set(draft.id, {
      author: text(draft.author),
      said: text(draft.ask) ?? text(draft.quote) ?? text(draft.title)
    })
  }
  return { channelNames, threads }
}

export async function readHqSlackScoutIndex(hqPath: string): Promise<HqSlackScoutIndex> {
  const read = (file: string): Promise<string> =>
    readFile(join(hqPath, HQ_SLACK_SCOUT_DIR, file), 'utf8').catch(() => '{}')
  const [drafts, decisions] = await Promise.all([
    read(HQ_SLACK_SCOUT_DRAFTS_FILE),
    read(HQ_SLACK_SCOUT_DECISIONS_FILE)
  ])
  return indexHqSlackScout(drafts, decisions)
}
