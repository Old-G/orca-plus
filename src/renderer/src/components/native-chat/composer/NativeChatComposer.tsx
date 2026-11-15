import { NativeChatTextAttachmentScope } from '../media/text/NativeChatTextAttachments'
import { forwardRef, useCallback, useImperativeHandle, useRef } from 'react'
import { NativeChatComposerPane } from './NativeChatComposerPane'
import { useNativeChatContinueNewAsk } from '../usage/use-native-chat-continue-new-ask'
import { NativeChatContinueNewAskBar } from '../usage/NativeChatContinueNew'
import type {
  NativeChatComposerHandle,
  NativeChatComposerProps
} from './native-chat-composer-types'

export const NativeChatComposer = forwardRef<NativeChatComposerHandle, NativeChatComposerProps>(
  function NativeChatComposer(props, ref): React.JSX.Element {
    // Custom build (chat-continue-new, T6 variant B): a due chat asks on send, in a bar over the field.
    const handle = useRef<NativeChatComposerHandle>(null)
    // Why a proxy: the pane rebuilds its handle on its own renders; the parent must always reach the live one.
    useImperativeHandle(
      ref,
      () =>
        new Proxy({} as NativeChatComposerHandle, {
          get: (_target, key) => handle.current?.[key as keyof NativeChatComposerHandle]
        }),
      []
    )
    const submit = useCallback(() => handle.current?.submit?.(), [])
    const { transport, ask } = useNativeChatContinueNewAsk(
      props.editSession ? undefined : props.structuredTransport,
      submit
    )
    return (
      <NativeChatTextAttachmentScope
        key={props.paneKey}
        enabled={Boolean(props.structuredTransport)}
      >
        <div
          className="contents"
          onKeyDownCapture={ask ? (event) => event.key === 'Escape' && ask.dismiss() : undefined}
        >
          {ask ? <NativeChatContinueNewAskBar ask={ask} /> : null}
          <NativeChatComposerPane
            {...props}
            structuredTransport={props.editSession ? props.structuredTransport : transport}
            ref={handle}
          />
        </div>
      </NativeChatTextAttachmentScope>
    )
  }
)
