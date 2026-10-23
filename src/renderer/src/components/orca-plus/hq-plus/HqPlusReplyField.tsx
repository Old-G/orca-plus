// Custom build (hq-plus-ui-v5): the field of every HQ+ reply box — wraps and grows to about six lines,
// Enter sends the form, Shift+Enter starts a new line.
import { useLayoutEffect, useRef } from 'react'

const MAX_LINES = 6

export function HqPlusReplyField(
  props: Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'rows'> & { value: string }
): React.JSX.Element {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const field = ref.current
    if (!field) {
      return
    }
    const line = Number.parseFloat(getComputedStyle(field).lineHeight) || 18
    field.style.height = 'auto'
    field.style.height = `${Math.min(field.scrollHeight, line * MAX_LINES)}px`
  }, [props.value])
  return (
    <textarea
      {...props}
      ref={ref}
      rows={1}
      onKeyDown={(event) => {
        props.onKeyDown?.(event)
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
          event.preventDefault()
          event.currentTarget.form?.requestSubmit()
        }
      }}
    />
  )
}
