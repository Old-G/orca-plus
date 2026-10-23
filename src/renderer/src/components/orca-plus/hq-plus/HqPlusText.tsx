// Custom build (hq-plus-ui-v2): an agent's markdown shown as clean feed text (see hq-plus-text).
import { hqPlusTextLines, type HqPlusSpan } from '../../../../../shared/hq-plus-text'
import { useHqPlusSlackText } from './use-hq-plus-slack-text'

function Span({ span }: { span: HqPlusSpan }): React.JSX.Element {
  switch (span.kind) {
    case 'bold':
      return <b>{span.text}</b>
    case 'code':
      return <code className="hqp-chip">{span.text}</code>
    case 'link':
      return (
        <a href={span.href} target="_blank" rel="noreferrer">
          {span.text}
        </a>
      )
    case 'text':
      return <>{span.text}</>
  }
}

export function HqPlusText({
  text,
  maxLines
}: {
  text: string
  maxLines?: number
}): React.JSX.Element {
  const lines = hqPlusTextLines(useHqPlusSlackText(text), maxLines)
  return (
    <span className="hqp-txt">
      {lines.map((line, index) => (
        <span key={index} className="hqp-txt-l" data-bullet={line.bullet ? 'true' : undefined}>
          {line.spans.map((span, at) => (
            <Span key={at} span={span} />
          ))}
        </span>
      ))}
    </span>
  )
}
