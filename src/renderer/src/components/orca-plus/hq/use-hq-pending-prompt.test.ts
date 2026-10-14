import { describe, expect, it } from 'vitest'
import type { AgentJournalResolution } from '../../../../../shared/agent-session-journal-types'
import type { StructuredPromptItem } from '../../native-chat/structured-agent-session-message-projection'
import { describeHqPendingPrompt } from './use-hq-pending-prompt'

const pending: AgentJournalResolution = {
  state: 'pending',
  selectedOptionId: null,
  resolvedBy: null,
  resolvedAt: null
}

function item(body: StructuredPromptItem['body']): StructuredPromptItem {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only `body` is read; the rest of the journal row is irrelevant here.
  return { body } as StructuredPromptItem
}

describe('describeHqPendingPrompt', () => {
  it('never grants an approval from the list: it shows what is asked and leaves the decision to the card', () => {
    const described = describeHqPendingPrompt(
      item({
        kind: 'approval',
        title: 'Run Bash',
        displayName: 'Bash',
        detail: 'rm -rf build',
        options: [
          { id: 'allow', label: 'Allow' },
          { id: 'always', label: "Allow, don't ask again" }
        ],
        resolution: pending
      })
    )
    expect(described).toMatchObject({ kind: 'approval', text: 'Bash', detail: 'rm -rf build' })
    expect(described.answers).toEqual([])
  })

  it('answers a lone single-choice question in place', () => {
    const described = describeHqPendingPrompt(
      item({
        kind: 'question',
        question: 'Какой цвет?',
        options: [
          { id: 'red', label: 'Красный' },
          { id: 'blue', label: 'Синий' }
        ],
        resolution: pending
      })
    )
    expect(described.text).toBe('Какой цвет?')
    expect(described.answers[1].response).toEqual({
      kind: 'answers',
      answers: [{ questionId: 'q1', optionIds: ['blue'] }]
    })
  })

  it('offers the options of a question that also takes free text', () => {
    const described = describeHqPendingPrompt(
      item({
        kind: 'question',
        question: 'Какой день?',
        options: [{ id: 'mon', label: 'Понедельник' }],
        freeTextQuestionId: 'day',
        resolution: pending
      })
    )
    expect(described.answers[0].response).toEqual({
      kind: 'answers',
      answers: [{ questionId: 'day', optionIds: ['mon'] }]
    })
  })

  it('leaves several questions and multi-select to the chat card', () => {
    const question = {
      id: 'q',
      question: 'Pick',
      multiSelect: false,
      options: [{ id: 'a', label: 'A' }]
    }
    const several = describeHqPendingPrompt(
      item({
        kind: 'question',
        question: 'Two things',
        options: [],
        questions: [question, { ...question, id: 'q2' }],
        resolution: pending
      })
    )
    expect(several.answers).toEqual([])
    const multi = describeHqPendingPrompt(
      item({
        kind: 'question',
        question: 'Pick',
        options: [],
        questions: [{ ...question, multiSelect: true }],
        resolution: pending
      })
    )
    expect(multi.answers).toEqual([])
  })
})
