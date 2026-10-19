import { describe, expect, it } from 'vitest'
import {
  untaggedNudgeReason,
  untaggedPeopleInClickUpComment,
  type TaggablePerson
} from './outgoing-clickup-untagged'

const PEOPLE: TaggablePerson[] = [
  { name: 'Лиза', clickupUserId: '91000001' },
  { name: 'Тимур', clickupUserId: null },
  { name: 'Катя', clickupUserId: '101000001' },
  { name: 'Nora Doe', clickupUserId: '81000001' }
]
const TOOL = 'mcp__claude_ai_ClickUp__clickup_create_comment'

function names(text: string, tool = TOOL): string[] {
  return untaggedPeopleInClickUpComment(tool, { comment_text: text }, PEOPLE).map((p) => p.name)
}

describe('untaggedPeopleInClickUpComment', () => {
  it('finds a declined Russian name without a tag', () => {
    expect(names('Дальше: довезти недостающее (владелец зоны — Лиза)')).toEqual(['Лиза'])
    expect(names('Ждём от Лизы и Тимура ответ')).toEqual(['Лиза', 'Тимур'])
    expect(names('Передал Кате')).toEqual(['Катя'])
  })

  it('accepts a name that is tagged', () => {
    expect(names('Вопрос [@Лиза](#user_mention#91000001): когда довезёшь?')).toEqual([])
  })

  it('still flags another person named beside a tagged one', () => {
    expect(names('[@Лиза](#user_mention#91000001), согласуй с Катей')).toEqual(['Катя'])
  })

  it('matches Latin first names', () => {
    expect(names('Nora asked for gift subscriptions')).toEqual(['Nora Doe'])
  })

  it('does not match words that merely start like a name', () => {
    expect(names('Каталог показал, что лизать не нужно')).toEqual([])
  })

  it('ignores other tools and servers', () => {
    expect(names('Лиза', 'mcp__claude_ai_Slack__slack_send_message')).toEqual([])
    expect(names('Лиза', 'mcp__claude_ai_ClickUp__clickup_create_task')).toEqual([])
  })
})

describe('untaggedNudgeReason', () => {
  it('gives the mention syntax when the id is known', () => {
    const reason = untaggedNudgeReason([PEOPLE[0], PEOPLE[1]])
    expect(reason).toContain('[@Лиза](#user_mention#91000001)')
    expect(reason).toContain('Тимур → id через clickup_resolve_assignees')
  })
})
