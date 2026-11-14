import { describe, expect, it } from 'vitest'
import { checkAgentLaunchModelPreferences } from '../../agent-launch/choices/agent-launch-model-preferences'
import { withHqTakeEffort } from '../../hq-triage'
import {
  CLAUDE_NEW_CHAT_MODEL,
  isFableModel,
  savedSelectionForNewChat
} from './claude-new-chat-model'
import {
  resolveNativeChatSessionOptionDefaults,
  resolveStructuredLaunchSeedOptions,
  structuredLaunchSeedOptions
} from './native-chat-session-option-defaults'
import type { PersistedNativeChatSessionOptions } from './native-chat-session-options'

/** The saved selection the owner's profile held on 14.11: Fable at xhigh picked last. */
const SAVED_FABLE: PersistedNativeChatSessionOptions = {
  claude: {
    model: 'claude-fable-5-2',
    valuesByModel: {
      opus: { effort: 'medium', fastMode: false },
      'claude-opus-5-5[1m]': { effort: 'high', fastMode: false },
      fable: { effort: 'high', fastMode: false },
      'claude-fable-5-2': { effort: 'xhigh' }
    }
  },
  codex: { model: 'gpt-6.1-sol', valuesByModel: { 'gpt-6.1-sol': { effort: 'xhigh' } } }
}

describe('a new Claude chat with no model named (chat-default-model)', () => {
  it('knows Fable by alias, by full id and with a window suffix, and nothing else', () => {
    for (const model of ['fable', 'Fable', 'fable[1m]', 'claude-fable-5-2', 'claude-fable-5[1m]']) {
      expect(isFableModel(model), model).toBe(true)
    }
    for (const model of ['opus', 'claude-opus-5-5[1m]', 'sonnet', 'fabled', 'my-fable', '', null]) {
      expect(isFableModel(model), String(model)).toBe(false)
    }
  })

  it('starts on Opus with the values saved for Opus, not on the saved Fable at its effort', () => {
    const opusAsSaved = { model: CLAUDE_NEW_CHAT_MODEL, effort: 'medium', fastMode: 'false' }
    expect(resolveStructuredLaunchSeedOptions(SAVED_FABLE, 'claude')).toEqual(opusAsSaved)
    // The seed a create and the pickers read, with the permission default beside the selection.
    const seed = structuredLaunchSeedOptions({ nativeChatSessionOptions: SAVED_FABLE }, 'claude')
    expect(seed).toMatchObject(opusAsSaved)
    expect(Object.values(seed ?? {}).some((value) => /fable|xhigh/u.test(value))).toBe(false)
  })

  it('starts on Opus with no effort flag when nothing was saved for Opus', () => {
    const saved = { claude: { model: 'fable', valuesByModel: { fable: { effort: 'xhigh' } } } }
    expect(resolveNativeChatSessionOptionDefaults(saved, 'claude')).toEqual({
      model: CLAUDE_NEW_CHAT_MODEL
    })
  })

  it('keeps any other saved model, and the same object, so nothing re-renders for it', () => {
    const saved: PersistedNativeChatSessionOptions = {
      claude: { model: 'claude-opus-5-5[1m]', valuesByModel: SAVED_FABLE.claude?.valuesByModel }
    }
    expect(savedSelectionForNewChat(saved)).toBe(saved)
    expect(resolveStructuredLaunchSeedOptions(saved, 'claude')).toEqual({
      model: 'claude-opus-5-5[1m]',
      effort: 'high',
      fastMode: 'false'
    })
    expect(savedSelectionForNewChat(undefined)).toBeUndefined()
    expect(savedSelectionForNewChat({})).toEqual({})
  })

  it('leaves the other agents and the saved record alone', () => {
    expect(resolveStructuredLaunchSeedOptions(SAVED_FABLE, 'codex')).toEqual({
      model: 'gpt-6.1-sol',
      effort: 'xhigh'
    })
    expect(savedSelectionForNewChat(SAVED_FABLE)?.codex).toBe(SAVED_FABLE.codex)
    expect(SAVED_FABLE.claude?.model).toBe('claude-fable-5-2')
  })

  it('still starts on Fable when Fable is named: `--model fable` or the default set in Settings', () => {
    // What `orca agent launch --model fable --effort high` sends as the chat's own options.
    expect(
      checkAgentLaunchModelPreferences({
        agent: 'claude',
        model: 'fable',
        effort: 'high',
        createsWorktree: false,
        openCodeModelLaunchSupported: true
      })
    ).toEqual({ preferences: { model: 'fable', effort: 'high' } })
    expect(
      structuredLaunchSeedOptions(
        {
          nativeChatSessionOptions: SAVED_FABLE,
          agentLaunchChoices: { claude: { model: 'fable', options: { effort: 'high' } } }
        },
        'claude'
      )
    ).toMatchObject({ model: 'fable', effort: 'high' })
  })

  it('runs a task taken in HQ on Opus at the take effort, not on the saved Fable', () => {
    const taken = withHqTakeEffort(SAVED_FABLE)
    expect(taken.claude?.model).toBe(CLAUDE_NEW_CHAT_MODEL)
    expect(taken.claude?.valuesByModel?.[CLAUDE_NEW_CHAT_MODEL]).toEqual({
      effort: 'high',
      fastMode: false
    })
    expect(taken.codex).toBe(SAVED_FABLE.codex)
  })
})
