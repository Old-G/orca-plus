// Custom build (hq-plus-ui-v3): × on a chat in HQ+ — closes its tab (it stays in History to reopen);
// a chat that is still working asks once, in a line, before it goes.
import { useState } from 'react'
import { translate } from '@/i18n/i18n'

export type HqPlusChatCloser = { working: boolean; close: () => void }

export function HqPlusCloseChat({
  closer,
  name
}: {
  closer: HqPlusChatCloser
  name: string
}): React.JSX.Element {
  const [asking, setAsking] = useState(false)
  if (asking) {
    return (
      <span className="hqp-confirm" role="group" aria-label={name}>
        <span>{translate('auto.hqPlus.closeWorking', 'Chat is working — close?')}</span>
        <button type="button" className="hqp-link" onClick={closer.close}>
          {translate('auto.hqPlus.closeChat.confirm', 'Close')}
        </button>
        <button
          type="button"
          className="hqp-link"
          data-ghost="true"
          onClick={() => setAsking(false)}
        >
          {translate('auto.hqPlus.closeChat.cancel', 'Cancel')}
        </button>
      </span>
    )
  }
  return (
    <button
      type="button"
      className="hqp-x"
      aria-label={translate('auto.hqPlus.closeChat.label', 'Close chat {{name}}', { name })}
      title={translate('auto.hqPlus.closeChat.title', 'Close chat (stays in History)')}
      onClick={() => (closer.working ? setAsking(true) : closer.close())}
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        aria-hidden="true"
      >
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    </button>
  )
}
