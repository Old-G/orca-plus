// Custom build (chat-continue-new, T6 variant B, owner 15.11): in a chat due for «Continue in new chat»
// the first send asks instead of sending — the bar over the field offers the new chat (a second Enter)
// or «Send here». The message stays in the field until a choice takes it.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { NativeChatStructuredComposerTransport } from '../composer/submit/native-chat-structured-composer-transport'
import {
  useNativeChatContinueNewOffer,
  type NativeChatContinueNew
} from './native-chat-continue-new-context'

export type NativeChatContinueNewChoice = 'new' | 'here'

export type NativeChatContinueNewAsk = {
  offer: NativeChatContinueNew
  choose: (choice: NativeChatContinueNewChoice) => void
  dismiss: () => void
}

/** Wraps the transport's send; `submit` sends the draft as Enter would, for the bar's buttons. */
export function useNativeChatContinueNewAsk(
  transport: NativeChatStructuredComposerTransport | undefined,
  submit: () => void
): {
  transport: NativeChatStructuredComposerTransport | undefined
  ask: NativeChatContinueNewAsk | null
} {
  const offer = useNativeChatContinueNewOffer()
  const [asked, setAsked] = useState(false)
  // Why refs: the send runs from the submit pipeline after its own awaits; the transport keeps its
  // identity so the composer's hooks do not re-run on every offer tick.
  const offerRef = useRef(offer)
  const askedRef = useRef(false)
  const choiceRef = useRef<NativeChatContinueNewChoice | null>(null)
  const show = useCallback((value: boolean) => {
    askedRef.current = value
    setAsked(value)
  }, [])
  useLayoutEffect(() => {
    offerRef.current = offer
  })
  const due = offer !== null
  useEffect(() => {
    if (!due) {
      // Why: a chat that moved on (a reply came, or it was continued) asks afresh next time.
      choiceRef.current = null
      show(false)
    }
  }, [due, show])

  const gated = useMemo((): NativeChatStructuredComposerTransport | undefined => {
    if (!transport) {
      return undefined
    }
    const send: NativeChatStructuredComposerTransport['send'] = (...args) => {
      const [text, attachments, request] = args
      const current = offerRef.current
      const choice = choiceRef.current
      choiceRef.current = null
      // Why: images, staged files and picked skills cannot move to the new chat, and a slash command
      // only runs at the start of a message; such a message goes here as before.
      if (
        !current ||
        attachments.length > 0 ||
        request?.prepareAttachments ||
        (request?.skills?.length ?? 0) > 0 ||
        text.trimStart().startsWith('/')
      ) {
        return transport.send(...args)
      }
      if (choice === 'here') {
        show(false)
        return transport.send(...args)
      }
      if (choice === 'new' || askedRef.current) {
        show(false)
        // A promise: the field empties as for a pending send and gets the text back on failure.
        return current.start(text)
      }
      show(true)
      return false
    }
    // Why a proxy, not a copy: every other field reads through to the live transport.
    return new Proxy(transport, {
      get: (target, key) => (key === 'send' ? send : Reflect.get(target, key))
    })
  }, [transport, show])

  const choose = useCallback(
    (choice: NativeChatContinueNewChoice) => {
      choiceRef.current = choice
      submit()
    },
    [submit]
  )
  const dismiss = useCallback(() => {
    choiceRef.current = null
    show(false)
  }, [show])

  return {
    transport: gated,
    ask: asked && offer ? { offer, choose, dismiss } : null
  }
}
