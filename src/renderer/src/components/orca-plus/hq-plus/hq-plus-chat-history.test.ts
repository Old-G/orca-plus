import { describe, expect, it } from 'vitest'
import {
  EMPTY_HQ_CHAT_HISTORY,
  HQ_CHAT_HISTORY_LIMIT,
  hqChatHistoryCanGo,
  hqChatHistoryCurrent,
  hqChatHistoryGo,
  hqChatHistoryVisit,
  type HqChatHistory
} from './hq-plus-chat-history'

const open = (): boolean => true
const visitAll = (...keys: string[]): HqChatHistory =>
  keys.reduce(hqChatHistoryVisit, EMPTY_HQ_CHAT_HISTORY)

describe('Session ← / → history (owner 27.11)', () => {
  it('A then B: back returns to A, forward to B again', () => {
    const ab = visitAll('A', 'B')
    const back = hqChatHistoryGo(ab, -1, open)
    expect(hqChatHistoryCurrent(back)).toBe('A')
    expect(hqChatHistoryCurrent(hqChatHistoryGo(back, 1, open))).toBe('B')
  })

  it('both arrows are off at the ends', () => {
    expect(hqChatHistoryCanGo(EMPTY_HQ_CHAT_HISTORY, -1, open)).toBe(false)
    expect(hqChatHistoryCanGo(EMPTY_HQ_CHAT_HISTORY, 1, open)).toBe(false)
    const a = visitAll('A')
    expect(hqChatHistoryCanGo(a, -1, open)).toBe(false)
    expect(hqChatHistoryCanGo(a, 1, open)).toBe(false)
    const ab = visitAll('A', 'B')
    expect(hqChatHistoryCanGo(ab, -1, open)).toBe(true)
    expect(hqChatHistoryCanGo(ab, 1, open)).toBe(false)
    const back = hqChatHistoryGo(ab, -1, open)
    expect(hqChatHistoryCanGo(back, -1, open)).toBe(false)
    expect(hqChatHistoryCanGo(back, 1, open)).toBe(true)
  })

  it('opening a chat after «back» cuts the forward branch', () => {
    const back = hqChatHistoryGo(visitAll('A', 'B', 'C'), -1, open)
    const branched = hqChatHistoryVisit(back, 'D')
    expect(branched.stack).toEqual(['A', 'B', 'D'])
    expect(hqChatHistoryCanGo(branched, 1, open)).toBe(false)
    expect(hqChatHistoryCurrent(hqChatHistoryGo(branched, -1, open))).toBe('B')
  })

  it('opening the chat already shown changes nothing', () => {
    const ab = visitAll('A', 'B')
    expect(hqChatHistoryVisit(ab, 'B')).toBe(ab)
  })

  it('a closed chat is skipped both ways, and an arrow with only closed chats behind it is off', () => {
    const abc = visitAll('A', 'B', 'C')
    const notB = (key: string): boolean => key !== 'B'
    const back = hqChatHistoryGo(abc, -1, notB)
    expect(hqChatHistoryCurrent(back)).toBe('A')
    expect(hqChatHistoryCurrent(hqChatHistoryGo(back, 1, notB))).toBe('C')
    const onlyC = (key: string): boolean => key === 'C'
    expect(hqChatHistoryCanGo(abc, -1, onlyC)).toBe(false)
    expect(hqChatHistoryGo(abc, -1, onlyC)).toBe(abc)
  })

  it('the same chat right behind the current one is not a step', () => {
    // A → B → A (visit), back must land on B, then on A, never on «A again».
    const aba = visitAll('A', 'B', 'A')
    const back = hqChatHistoryGo(aba, -1, open)
    expect(hqChatHistoryCurrent(back)).toBe('B')
    expect(hqChatHistoryCurrent(hqChatHistoryGo(back, -1, open))).toBe('A')
  })

  it('keeps the newest entries only', () => {
    const keys = Array.from({ length: HQ_CHAT_HISTORY_LIMIT + 5 }, (_, i) => `c${i}`)
    const long = visitAll(...keys)
    expect(long.stack).toHaveLength(HQ_CHAT_HISTORY_LIMIT)
    expect(hqChatHistoryCurrent(long)).toBe(keys.at(-1))
    expect(long.stack[0]).toBe('c5')
  })
})
