// Custom build (hq-reply-addressee): whether a message in a watched thread speaks to the owner. One
// that @mentions someone else and not him is their conversation, not his answer; a sync bot's copy
// of the owner's own Slack words is not an answer either.

const norm = (value: string): string => value.trim().toLowerCase()

// Why the leading boundary: «a@b.c» is an e-mail, not a mention.
const CLICKUP_MENTION = /(?:^|[\s(])@([\p{L}][\p{L}'.-]*(?:[  ][\p{L}][\p{L}'.-]*)?)/gu
// e.g. «[Slack Sync] 💬 @Alex Owner (Slack): text» — a bot copying a Slack message to a task.
const SLACK_SYNC = /^\s*\[Slack Sync\][^@]*@([^(\n]+?)\s*\(Slack\):\s*/u

function namesMatch(mention: string, owner: string): boolean {
  const said = norm(mention)
  const name = norm(owner)
  return said === name || name.startsWith(`${said} `) || said.startsWith(`${name} `)
}

/** False for a ClickUp comment addressed to others, or a synced copy of the owner's own words. */
export function clickUpCommentForOwner(body: string, ownerName: string): boolean {
  const synced = SLACK_SYNC.exec(body)
  if (synced && namesMatch(synced[1], ownerName)) {
    return false
  }
  const text = synced ? body.slice(synced[0].length) : body
  const mentions = [...text.matchAll(CLICKUP_MENTION)].map((match) => match[1])
  return mentions.length === 0 || mentions.some((mention) => namesMatch(mention, ownerName))
}

/** False for a Slack message that mentions people and not the owner (`<@U…>` markup). */
export function slackMessageForOwner(text: string, ownerId: string): boolean {
  const mentions = [...text.matchAll(/<@([A-Z0-9]+)(?:\|[^>]*)?>/g)].map((match) => match[1])
  return mentions.length === 0 || mentions.includes(ownerId)
}
