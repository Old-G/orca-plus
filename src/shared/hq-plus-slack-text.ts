// Custom build (hq-plus-ui-v5): Slack markup in HQ+ text read as Slack shows it — `<@U…>` as the
// person's name, `<url|label>` as a link, `:blush:` (with `::skin-tone-N:`) as the emoji.
export type HqPlusSlackLookups = {
  nameOf: (slackUserId: string) => string | null
  emojiOf: (shortcode: string) => string | null
}

const SKIN_TONES = ['\u{1F3FB}', '\u{1F3FC}', '\u{1F3FD}', '\u{1F3FE}', '\u{1F3FF}']

export function hqPlusSlackText(text: string, lookups: HqPlusSlackLookups): string {
  return text
    .replace(/<@([UW][A-Z0-9]+)(?:\|([^>]+))?>/g, (whole, id: string, label?: string) => {
      const name = lookups.nameOf(id) ?? label
      return name ? `@${name}` : whole
    })
    .replace(/<#[CG][A-Z0-9]+\|([^>]+)>/g, '#$1')
    .replace(/<!(here|channel|everyone)>/g, '@$1')
    .replace(/<(https?:\/\/[^|>\s]+)\|([^>]+)>/g, '[$2]($1)')
    .replace(/<(https?:\/\/[^|>\s]+)>/g, '$1')
    .replace(/:([a-z0-9_+-]+):(?::skin-tone-([2-6]):)?/g, (whole, code: string, tone?: string) => {
      const emoji = lookups.emojiOf(code) ?? lookups.emojiOf(code.replace(/-/g, '_'))
      if (!emoji) {
        return whole
      }
      return tone ? `${emoji}${SKIN_TONES[Number(tone) - 2]}` : emoji
    })
}
