// Custom build (hq-plus-ui-v5): Slack markup in HQ+ text with the people HQ knows by Slack id.
import { useEffect, useState } from 'react'
import { readHqPeople } from '../../../../../shared/hq-people'
import { hqPlusSlackText } from '../../../../../shared/hq-plus-slack-text'
import { emojiForShortcode } from '@/lib/workspace-emoji-shortcodes'

let names: ReadonlyMap<string, string> | null = null
let loading: Promise<void> | null = null
const listeners = new Set<() => void>()

function loadNames(): Promise<void> {
  loading ??= window.api.runtime
    .call({ method: 'hqProjects.people' })
    .then((response) => {
      const people = response.ok ? readHqPeople(response.result) : []
      names = new Map(
        people.flatMap((row) => (row.slackUserId ? [[row.slackUserId, row.name] as const] : []))
      )
      for (const listener of listeners) {
        listener()
      }
    })
    .catch(() => {
      // Why: without the roster a mention keeps its Slack form; the next mount tries again.
      loading = null
    })
  return loading
}

/** The text with Slack mentions, links and emoji resolved; ids stay until the roster loads. */
export function useHqPlusSlackText(text: string): string {
  const [, setVersion] = useState(0)
  useEffect(() => {
    if (names || !/<@[UW]/.test(text)) {
      return
    }
    const listener = (): void => setVersion((version) => version + 1)
    listeners.add(listener)
    void loadNames()
    return () => {
      listeners.delete(listener)
    }
  }, [text])
  if (!/[<:]/.test(text)) {
    return text
  }
  return hqPlusSlackText(text, {
    nameOf: (id) => names?.get(id) ?? null,
    emojiOf: emojiForShortcode
  })
}
