// Custom build (hq-plus-chat-tree, owner 04.11): «By status | By work» over the left column's chats —
// by project and status as before, or each chat under the chat that started it. Remembered per window.
import { useState } from 'react'
import { translate } from '@/i18n/i18n'
import { readHqPlusViewState, saveHqPlusViewState, type HqPlusChatsBy } from './hq-plus-view-state'

export function useHqPlusChatsBy(): [HqPlusChatsBy, (next: HqPlusChatsBy) => void] {
  const [chatsBy, setChatsBy] = useState<HqPlusChatsBy>(() => readHqPlusViewState().chatsBy)
  return [
    chatsBy,
    (next) => {
      setChatsBy(next)
      saveHqPlusViewState({ chatsBy: next })
    }
  ]
}

export function HqPlusChatsBySwitch({
  chatsBy,
  onChange
}: {
  chatsBy: HqPlusChatsBy
  onChange: (next: HqPlusChatsBy) => void
}): React.JSX.Element {
  return (
    <div className="hqm-seg hqp-chats-by" role="group" aria-label="Group chats">
      {(['status', 'work'] as const).map((name) => (
        <button
          key={name}
          type="button"
          aria-pressed={chatsBy === name}
          title={
            name === 'work'
              ? translate(
                  'auto.hqPlus.side.byWorkTip',
                  'Each chat under the chat that started it or handed it work'
                )
              : translate('auto.hqPlus.side.byStatusTip', 'Chats by project and status')
          }
          onClick={() => onChange(name)}
        >
          {name === 'work'
            ? translate('auto.hqPlus.side.byWork', 'By work')
            : translate('auto.hqPlus.side.byStatus', 'By status')}
        </button>
      ))}
    </div>
  )
}
