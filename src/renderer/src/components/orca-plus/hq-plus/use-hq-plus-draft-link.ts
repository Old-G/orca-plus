// Custom build (hq-plus-side-blocks): a Slack/ClickUp request card keeps only its scout draft's id; the
// link to the message lives in the draft. One read of the drafts serves every card for a minute.
import { useEffect, useState } from 'react'
import { readHqSlackRequestRef } from '../../../../../shared/hq-slack-request-bell'

const FRESH_MS = 60_000

let cache: { at: number; links: Promise<ReadonlyMap<string, string>> } | null = null

function draftLinks(): Promise<ReadonlyMap<string, string>> {
  if (!cache || Date.now() - cache.at > FRESH_MS) {
    cache = {
      at: Date.now(),
      links: window.api.hqProjects
        .slackDrafts()
        .then(
          (result) =>
            new Map(
              result.ok
                ? result.drafts.flatMap((draft) =>
                    draft.permalink ? [[draft.id, draft.permalink] as const] : []
                  )
                : []
            )
        )
        .catch(() => new Map<string, string>())
    }
  }
  return cache.links
}

/** The message a scout request card came from; null for other cards or until read. */
export function useHqPlusDraftLink(refId: string | null): string | null {
  const id = readHqSlackRequestRef(refId)?.id ?? null
  const [link, setLink] = useState<{ id: string; url: string | null } | null>(null)
  useEffect(() => {
    if (!id) {
      return
    }
    let live = true
    void draftLinks().then((links) => {
      if (live) {
        setLink({ id, url: links.get(id) ?? null })
      }
    })
    return () => {
      live = false
    }
  }, [id])
  return link && link.id === id ? link.url : null
}
