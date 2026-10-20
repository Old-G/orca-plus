// Custom build (outgoing-approval, W42 #13, owner 18.10): a project's bot previews sent to the owner's
// own Telegram chat pass without a card. Channels, literal ids, other projects and other hosts stay held.

/** Projects whose agents may message the owner's chat (`OWNER_CHAT_ID` in their `.env`) freely;
 *  the owner lists them as `owner_preview_projects` in HQ's slack-scout/config.yaml. */
let ownerPreviewProjects: ReadonlySet<string> = new Set()

export function setOwnerPreviewProjects(names: Iterable<string>): void {
  ownerPreviewProjects = new Set(names)
}

/** `owner_preview_projects: [news_bot, other]` → its names; none when the key is absent. */
export function parseOwnerPreviewProjects(config: string): string[] {
  const line = /^owner_preview_projects:\s*\[?([^\]\n#]*)/m.exec(config)?.[1] ?? ''
  return [...line.matchAll(/[\w.-]+/g)].map((match) => match[0])
}

const TELEGRAM_HOST = /^api\.telegram\.org$/i
const LOCAL_HOST = /^(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[?::1\]?|[\w-]+\.localhost)$/i

// Why: the command may quote its script for `ssh '…'` / `python -c "…"`, escaping the inner quotes.
const Q = String.raw`\\?["']`
const SHELL_REF = String.raw`\$\{?OWNER_CHAT_ID\}?`
// `e["OWNER_CHAT_ID"]`, `os.environ["OWNER_CHAT_ID"]`, `os.getenv("OWNER_CHAT_ID")`.
const SCRIPT_REF = String.raw`[\w.]+(?:\[|\()\s*${Q}OWNER_CHAT_ID${Q}\s*[\])]`
const END = String.raw`(?=[\s,})&;|#]|$)`
const CHAT_ID_VALUE = new RegExp(
  String.raw`^(?:${Q})?\s*[:=]\s*(?:(?:${Q})?${SHELL_REF}(?:${Q})?|${SCRIPT_REF}|([A-Za-z_]\w*))${END}`
)
const OWNER_REF_ONLY = new RegExp(String.raw`^(?:${SCRIPT_REF}|${SHELL_REF})\s*(?:[;#\n]|$)`)
// Why: a set, a default or a dict key can point OWNER_CHAT_ID itself at a channel.
const OWNER_OVERRIDE = new RegExp(
  String.raw`OWNER_CHAT_ID(?:${Q})?\]?\s*(?:=(?!=)|:)|(?:setdefault|putenv)\s*\(\s*${Q}OWNER_CHAT_ID`
)
// Why: a body read from a file or unpacked from a dict can carry a chat_id this text never shows.
const HIDDEN_PARAMS = /\*\*\s*[\w(]|(?:\s-d|--data[\w-]*|--json)[=\s]*['"]?@|\s(?:-K|--config)[=\s]/

function inPreviewProject(cwd: string | null): boolean {
  return !!cwd && cwd.split(/[\\/]/).some((part) => ownerPreviewProjects.has(part))
}

/** A variable bound only to the owner's chat id, never rebound by a loop, `as` or a parameter. */
function isOwnerVariable(name: string, command: string): boolean {
  if (new RegExp(String.raw`\b(?:for|as|def|lambda)\b[^\n:]*?(?<![\w.])${name}\b`).test(command)) {
    return false
  }
  const bindings = [
    ...command.matchAll(new RegExp(String.raw`(?<![\w.])${name}\s*(?::=|[-+*/|&]?=(?!=))\s*`, 'g'))
  ]
  return (
    bindings.length > 0 &&
    bindings.every(
      (match) =>
        !/[-+*/|&]=/.test(match[0]) &&
        OWNER_REF_ONLY.test(command.slice(match.index + match[0].length))
    )
  )
}

/** Every Telegram call in the command goes to the owner's chat: each `chat_id` is OWNER_CHAT_ID. */
export function isOwnerTelegramPreview(
  command: string,
  hosts: readonly string[],
  cwd: string | null
): boolean {
  if (!inPreviewProject(cwd) || OWNER_OVERRIDE.test(command) || HIDDEN_PARAMS.test(command)) {
    return false
  }
  const remote = hosts.filter((host) => !LOCAL_HOST.test(host))
  if (remote.length === 0 || !remote.every((host) => TELEGRAM_HOST.test(host))) {
    return false
  }
  const chatIds = [...command.matchAll(/\bchat_id\b/g)]
  return (
    chatIds.length > 0 &&
    chatIds.every((match) => {
      const value = CHAT_ID_VALUE.exec(command.slice(match.index + 'chat_id'.length))
      return !!value && (!value[1] || isOwnerVariable(value[1], command))
    })
  )
}
