// Custom build (clickup-untagged-nudge): a ClickUp comment that names a teammate without an @mention
// never notifies them, so the gate hands it back to the agent once to add the tag.
import { parseMcpToolName } from './outgoing-mcp-rules'

export type TaggablePerson = { name: string; clickupUserId: string | null }

const COMMENT_TOOLS = new Set(['clickup_create_comment', 'clickup_create_task_comment'])
const LETTER = '\\p{L}'
// Why: Russian names decline ("Лизе", "Тимура"); the stem plus a case ending still names the person.
const VOWEL_ENDINGS = ['а', 'я', 'ы', 'и', 'е', 'у', 'ю', 'ой', 'ей', 'ою', 'ею']
const CONSONANT_ENDINGS = ['', 'а', 'у', 'ом', 'е', 'ем', 'я', 'ю']

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function namePattern(firstName: string): RegExp {
  const lower = firstName.toLowerCase()
  const forms = /[а-яё]/.test(lower)
    ? /[ая]$/.test(lower)
      ? VOWEL_ENDINGS.map((ending) => lower.slice(0, -1) + ending)
      : CONSONANT_ENDINGS.map((ending) => lower + ending)
    : [lower]
  return new RegExp(`(?<!${LETTER})(?:${forms.map(escape).join('|')})(?!${LETTER})`, 'iu')
}

function mentionedIds(text: string): Set<string> {
  return new Set([...text.matchAll(/#user_mention#(\d+)/g)].map((match) => match[1]))
}

/** Teammates the comment names but does not @mention; empty for any other call. */
export function untaggedPeopleInClickUpComment(
  toolName: string,
  input: Record<string, unknown>,
  people: readonly TaggablePerson[]
): TaggablePerson[] {
  const name = parseMcpToolName(toolName)
  const text = input.comment_text
  if (!name || !/clickup/i.test(name.server) || !COMMENT_TOOLS.has(name.tool)) {
    return []
  }
  if (typeof text !== 'string') {
    return []
  }
  const tagged = mentionedIds(text)
  // Why: the link text of a mention spells the name, so it must not count as naming someone untagged.
  const prose = text.replace(/\[@[^\]]*\]\(#user_mention#\d+\)/g, ' ')
  return people.filter((person) => {
    const firstName = person.name.trim().split(/\s+/)[0]
    if (!firstName || (person.clickupUserId && tagged.has(person.clickupUserId))) {
      return false
    }
    return namePattern(firstName).test(prose)
  })
}

export function untaggedNudgeReason(people: readonly TaggablePerson[]): string {
  const list = people
    .map((person) =>
      person.clickupUserId
        ? `${person.name} → [@${person.name}](#user_mention#${person.clickupUserId})`
        : `${person.name} → id через clickup_resolve_assignees`
    )
    .join('; ')
  return (
    `Orca+: комментарий называет людей без тега — уведомление им не придёт: ${list}. ` +
    'Если от них ждём ответа или действия, добавь тег в текст и отправь снова. ' +
    'Если тег не нужен (просто упоминание в отчёте), повтори тот же вызов без изменений — он пройдёт.'
  )
}
