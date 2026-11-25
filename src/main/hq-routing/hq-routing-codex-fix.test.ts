import { describe, expect, it } from 'vitest'
import { hqCodexFixFollowUp, hqCodexFixPrompt } from './hq-routing-codex-fix'

const prompt = (project: string, level: number): string =>
  hqCodexFixPrompt({
    projectName: project,
    project,
    address: `${project}/codex-fix-2026-11-25`,
    level,
    findings: [],
    commits: []
  })

// 25.11 (итоги дня №1): the owner wrote «да, вливай и выкатывай» to fixing chats six times in a day.
describe('the fixing chat at level 3', () => {
  it('merges through the merge slot and deploys by itself once the head is green and Codex has no blockers', () => {
    const text = prompt('flowbridge', 3)
    expect(text).toContain('«да» владельца не ждёшь')
    expect(text).toContain('Пайплайн на голове зелёный и у Codex нет блокеров')
    expect(text).toContain('orca hq merge-slot take flowbridge')
    expect(text).toContain('`lh-server-ssh`')
    expect(text).toContain('«Выкачено, проверено <что увидел>»')
    expect(text).not.toContain('ни при каком уровне')
  })

  it('after the rebase in the merge slot merges only a head that passed the pipeline and the review', () => {
    const text = prompt('flowbridge', 3)
    expect(text).toContain('дождись зелёного пайплайна (все обязательные проверки) на новой голове')
    expect(text).toContain('повтори ревью Codex на ней')
    expect(text).toContain('вливаешь только ту голову, что прошла пайплайн и ревью')
    expect(text).toContain('продлевай слот `orca hq merge-slot take flowbridge` каждые 10 минут')
  })

  it('reads the level again before merging and deploying, and a follow-up says the level now', () => {
    expect(prompt('flowbridge', 3)).toContain(
      'Перед вливанием и перед выкаткой перечитай уровень: `orca hq context --project flowbridge`'
    )
    const followUp = (level: number): string =>
      hqCodexFixFollowUp({
        findings: [],
        commits: [],
        project: 'flowbridge',
        address: 'flowbridge/codex-fix-2026-11-25',
        level
      })
    expect(followUp(2)).toContain('Уровень проекта сейчас 2, это важнее первого сообщения')
    expect(followUp(2)).toContain('не вливай')
    expect(followUp(2)).not.toContain('lh-server-ssh')
    // Why: a chat opened below 3 has no shipping steps of its own; the follow-up brings them.
    expect(followUp(3)).toContain('`lh-server-ssh`')
    expect(followUp(3)).toContain('Ответ не «slot renewed»')
  })

  it('still asks the owner about deploying from CI, the production database and money', () => {
    const text = prompt('flowbridge', 3)
    expect(text).toContain(
      'orca hq report --address flowbridge/codex-fix-2026-11-25 --done "<что готово>" --ask "Влить и выкатить <MR>?"'
    )
    expect(text).toMatch(/выкатывает прод из CI; правка трогает прод-БД .* или деньги/)
  })

  it('merges Orca+ but leaves its ship to the next one, since a ship restarts the app', () => {
    const text = prompt('orca-custom', 3)
    expect(text).toContain('Orca+ не выкатывай')
    expect(text).not.toContain('lh-server-ssh')
  })

  it('below level 3 keeps production for the owner and does not merge', () => {
    const text = prompt('lh-it-hub', 2)
    expect(text).toContain('не вливай')
    expect(text).toContain('только после «да» владельца')
    expect(text).not.toContain('lh-server-ssh')
  })
})
