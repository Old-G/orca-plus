// Custom build (hq-plus-ui-v4): HQ+'s feed keys — single keys, like a mail client's — rebindable in
// Settings → Shortcuts. The HQ+ screen matches them itself, only while it is on view and no text field
// has focus, so they never reach a terminal, an editor or a chat composer.
import type { HqPlusKeybindingActionId, KeybindingDefinition } from './types'
import { platformBindings } from './definitions-support'

function hqPlusKey(
  id: HqPlusKeybindingActionId,
  title: string,
  bindings: readonly string[],
  keywords: readonly string[]
): KeybindingDefinition {
  return {
    id,
    title,
    group: 'HQ+',
    scope: 'hqPlus',
    searchKeywords: ['shortcut', 'hq+', 'hq plus', 'feed', ...keywords],
    defaultBindings: platformBindings(bindings),
    allowBareKeybindings: true,
    allowPrintableBareKeybindings: true
  }
}

export const KEYBINDING_DEFINITIONS_HQ_PLUS: readonly KeybindingDefinition[] = [
  hqPlusKey('hqPlus.next', 'Next card (your move first)', ['J'], ['next', 'down']),
  hqPlusKey('hqPlus.previous', 'Previous card (your move first)', ['K'], ['previous', 'up']),
  hqPlusKey('hqPlus.toggle', 'Expand or collapse the card', ['Enter'], ['expand', 'collapse']),
  hqPlusKey('hqPlus.open', 'Open the chat in Session', ['O'], ['open', 'session', 'chat']),
  hqPlusKey('hqPlus.reply', "Write in the card's reply box", ['R'], ['reply', 'answer']),
  hqPlusKey('hqPlus.done', 'Done on a waiting item', ['E'], ['done', 'resolve', 'archive']),
  hqPlusKey('hqPlus.close', 'Close the chat', ['X'], ['close', 'chat']),
  hqPlusKey('hqPlus.search', 'Search the feed', ['Slash', 'Mod+F'], ['search', 'find']),
  hqPlusKey('hqPlus.filterAll', 'Show everything', ['1'], ['filter', 'all']),
  hqPlusKey('hqPlus.filterMove', 'Show your move', ['2'], ['filter', 'your move']),
  hqPlusKey('hqPlus.filterChats', 'Show chats', ['3'], ['filter', 'chats']),
  hqPlusKey('hqPlus.filterInbox', 'Show inbox', ['4'], ['filter', 'inbox']),
  hqPlusKey('hqPlus.escape', 'Collapse, clear the search', ['Escape'], ['escape', 'collapse'])
]
