// Custom build (hq-plus-ui-v2): an agent's markdown shown as clean feed text (see hq-plus-text).
import { hqPlusTextLines, type HqPlusSpan } from '../../../../../shared/hq-plus-text'
import { splitHqBrainEntities } from '../../../../../shared/hq-brain'
import { useHqPlusSlackText } from './use-hq-plus-slack-text'
import { HqPlusBrainLink } from './HqPlusBrainLink'

/** Custom build (hq-plus-brain): a task id or an MR in the text opens Brain on it. */
function Mentions({ text }: { text: string }): React.JSX.Element {
  return (
    <>
      {splitHqBrainEntities(text).map((part, at) =>
        part.kind === 'entity' ? (
          <HqPlusBrainLink key={at} entity={part.entity}>
            {part.text}
          </HqPlusBrainLink>
        ) : (
          part.text
        )
      )}
    </>
  )
}

function Span({ span }: { span: HqPlusSpan }): React.JSX.Element {
  switch (span.kind) {
    case 'bold':
      return (
        <b>
          <Mentions text={span.text} />
        </b>
      )
    case 'code':
      return <code className="hqp-chip">{span.text}</code>
    case 'link':
      return (
        <a href={span.href} target="_blank" rel="noreferrer">
          {span.text}
        </a>
      )
    case 'text':
      return <Mentions text={span.text} />
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
        <span
          key={index}
          className="hqp-txt-l"
          data-bullet={line.bullet ? 'true' : undefined}
          data-label={line.label?.kind}
        >
          {/* Custom build (hq-plus-map): «Done», «Question» as a small label, the line in its own tone. */}
          {line.label ? <span className="hqp-txt-k">{line.label.text}</span> : null}
          {line.spans.map((span, at) => (
            <Span key={at} span={span} />
          ))}
        </span>
      ))}
    </span>
  )
}
