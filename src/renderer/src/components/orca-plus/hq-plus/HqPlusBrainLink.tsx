// Custom build (hq-plus-brain): a mention that opens HQ+'s «Brain» on itself — a task id or an MR in a
// card's text, a person's or a project's name in its head. A span, not a button: it may sit inside a
// card's own button (a folded line), and its click stays its own.
import { translate } from '@/i18n/i18n'
import { openHqPlusBrain } from './hq-plus-brain-open'

export function HqPlusBrainLink({
  entity,
  children,
  strong = false
}: {
  entity: string
  children: React.ReactNode
  /** A name in a card's head keeps its weight. */
  strong?: boolean
}): React.JSX.Element {
  const open = (event: React.SyntheticEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    openHqPlusBrain(entity)
  }
  const Tag = strong ? 'strong' : 'span'
  return (
    <Tag
      role="link"
      tabIndex={0}
      className="hqp-ent"
      title={translate('auto.hqPlus.brain.open', 'Everything about {{entity}} in Brain', {
        entity
      })}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          open(event)
        }
      }}
    >
      {children}
    </Tag>
  )
}

/** Names in a card's head, «Ann, Bob», each opening Brain on that person. */
export function HqPlusBrainNames({ names }: { names: readonly string[] }): React.JSX.Element {
  return (
    <>
      {names.map((name, at) => (
        <span key={name}>
          {at > 0 ? ', ' : null}
          <HqPlusBrainLink entity={name} strong>
            {name}
          </HqPlusBrainLink>
        </span>
      ))}
    </>
  )
}
