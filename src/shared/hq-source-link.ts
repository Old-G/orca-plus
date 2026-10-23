// Custom build (hq-plus-ui-v5): which known service a request's source link points at — by exact host
// or a dot-bounded subdomain, so `evilslack.com` or `slack.com.evil.example` are not taken for Slack.
export type HqSourceService = 'slack' | 'clickup' | 'gmail' | 'gitlab'

const HOSTS: readonly (readonly [string, HqSourceService])[] = [
  ['mail.google.com', 'gmail'],
  ['slack.com', 'slack'],
  ['clickup.com', 'clickup'],
  ['gitlab.com', 'gitlab']
]

/** The service behind an https link; null for any other link or anything that is not one. */
export function hqSourceService(url: string): HqSourceService | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:') {
    return null
  }
  const host = parsed.hostname.toLowerCase()
  return HOSTS.find(([domain]) => host === domain || host.endsWith(`.${domain}`))?.[1] ?? null
}
