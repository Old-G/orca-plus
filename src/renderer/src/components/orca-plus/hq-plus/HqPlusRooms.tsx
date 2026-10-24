// Custom build (hq-rooms): HQ+'s row of rooms — each room is an Orca sidebar group, so «+» makes a
// group, and a room's «⋯» renames, recolours or removes the room and its group together. Projects
// move between rooms by «Move to group» in the sidebar; ones in no group sit in the default room.
import { useState } from 'react'
import { REPO_COLORS } from '../../../../../shared/constants'
import type { HqSpace } from '../../../../../shared/hq-spaces'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { translate } from '@/i18n/i18n'
import { reloadHqSpaces } from '../hq/use-hq-spaces'

type RoomCall = 'hqProjects.roomCreate' | 'hqProjects.roomUpdate' | 'hqProjects.roomRemove'

async function callRoom(method: RoomCall, params: Record<string, string>): Promise<string | null> {
  try {
    const response = await window.api.runtime.call({ method, params })
    if (!response.ok) {
      return response.error?.message ?? translate('auto.hqPlus.rooms.failed', 'It did not work')
    }
    reloadHqSpaces()
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

function roomStyle(
  color: string | null
): (React.CSSProperties & Record<'--hqp-room', string>) | undefined {
  return color ? { '--hqp-room': color } : undefined
}

function Swatches({
  value,
  extra,
  onPick
}: {
  value: string
  extra: string | null
  onPick: (color: string) => void
}): React.JSX.Element {
  const colors =
    extra && !REPO_COLORS.some((color) => color === extra) ? [extra, ...REPO_COLORS] : REPO_COLORS
  return (
    <div
      className="hqp-swatches"
      role="radiogroup"
      aria-label={translate('auto.hqPlus.rooms.color', 'Colour')}
    >
      {colors.map((color) => (
        <button
          key={color}
          type="button"
          role="radio"
          aria-checked={value === color}
          aria-label={color}
          style={roomStyle(color)}
          onClick={() => onPick(color)}
        />
      ))}
    </div>
  )
}

/** Name and colour; the same form makes a room and edits one. */
function RoomForm({
  space,
  onDone
}: {
  space: HqSpace | null
  onDone: () => void
}): React.JSX.Element {
  const [name, setName] = useState(space?.name ?? '')
  const [color, setColor] = useState(space?.color ?? REPO_COLORS[4])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)
  const run = (method: RoomCall, params: Record<string, string>): void => {
    setBusy(true)
    setError(null)
    void callRoom(method, params).then((failed) => {
      setBusy(false)
      if (failed) {
        setError(failed)
      } else {
        onDone()
      }
    })
  }
  const save = (): void => {
    const trimmed = name.trim()
    if (!trimmed) {
      return
    }
    if (!space) {
      run('hqProjects.roomCreate', { name: trimmed, color })
      return
    }
    run('hqProjects.roomUpdate', {
      space: space.slug,
      ...(trimmed !== space.name ? { name: trimmed } : {}),
      ...(color !== space.color ? { color } : {})
    })
  }
  return (
    <form
      className="hqp-roomform"
      onSubmit={(event) => {
        event.preventDefault()
        save()
      }}
    >
      <label className="hqp-roomform-l" htmlFor="hqp-room-name">
        {space
          ? translate('auto.hqPlus.rooms.editTitle', 'Room and its sidebar group')
          : translate('auto.hqPlus.rooms.newTitle', 'New room — a new group in the sidebar')}
      </label>
      <input
        id="hqp-room-name"
        className="hqp-roomform-in"
        value={name}
        maxLength={80}
        autoFocus
        placeholder={translate('auto.hqPlus.rooms.namePlaceholder', 'Name')}
        onChange={(event) => setName(event.target.value)}
      />
      <Swatches value={color} extra={space?.color ?? null} onPick={setColor} />
      <p className="hqp-roomform-hint">
        {space?.isDefault
          ? translate(
              'auto.hqPlus.rooms.defaultHint',
              'Every project in no group lives here. Move one out with «Move to group» in the sidebar.'
            )
          : translate(
              'auto.hqPlus.rooms.groupHint',
              'Projects join it with «Move to group» in the sidebar; a renamed group renames the room.'
            )}
      </p>
      {error ? <p className="hqp-error">{error}</p> : null}
      <div className="hqp-roomform-acts">
        {space && !space.isDefault ? (
          removing ? (
            <button
              type="button"
              className="hqp-opt"
              data-danger="true"
              disabled={busy}
              onClick={() => run('hqProjects.roomRemove', { space: space.slug })}
            >
              {translate(
                'auto.hqPlus.rooms.removeSure',
                'Remove — projects go to the default room'
              )}
            </button>
          ) : (
            <button
              type="button"
              className="hqp-opt"
              data-ghost="true"
              disabled={busy}
              onClick={() => setRemoving(true)}
            >
              {translate('auto.hqPlus.rooms.remove', 'Remove room')}
            </button>
          )
        ) : null}
        <span className="hqp-spacer" />
        <button type="submit" className="hqp-opt" data-main="true" disabled={busy || !name.trim()}>
          {space
            ? translate('auto.hqPlus.rooms.save', 'Save')
            : translate('auto.hqPlus.rooms.create', 'Create')}
        </button>
      </div>
    </form>
  )
}

export function HqPlusRooms({
  spaces,
  active,
  allLabel,
  countOf,
  onPick
}: {
  spaces: readonly HqSpace[]
  active: string | null
  allLabel: string
  countOf: (slug: string | null) => number
  onPick: (slug: string | null) => void
}): React.JSX.Element {
  const [editing, setEditing] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const count = (slug: string | null): React.ReactNode => {
    const n = countOf(slug)
    return n ? <em>{n}</em> : null
  }
  return (
    <div className="hqp-rooms" role="group" aria-label={translate('auto.hqPlus.rooms', 'Rooms')}>
      <button
        type="button"
        className="hqp-room"
        aria-pressed={active === null}
        onClick={() => onPick(null)}
      >
        <i aria-hidden="true" />
        {allLabel}
        {count(null)}
      </button>
      {spaces.map((space) => (
        <span key={space.slug} className="hqp-room-wrap" style={roomStyle(space.color)}>
          <button
            type="button"
            className="hqp-room"
            aria-pressed={active === space.slug}
            onClick={() => onPick(space.slug)}
            onContextMenu={(event) => {
              event.preventDefault()
              setEditing(space.slug)
            }}
          >
            <i aria-hidden="true" />
            {space.name}
            {count(space.slug)}
          </button>
          {active === space.slug || editing === space.slug ? (
            <Popover
              open={editing === space.slug}
              onOpenChange={(open) => setEditing(open ? space.slug : null)}
            >
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="hqp-room-more"
                  aria-label={translate('auto.hqPlus.rooms.edit', 'Edit room {{name}}', {
                    name: space.name
                  })}
                >
                  ⋯
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="hq-plus-pop w-80 p-3">
                <RoomForm space={space} onDone={() => setEditing(null)} />
              </PopoverContent>
            </Popover>
          ) : null}
        </span>
      ))}
      <Popover open={creating} onOpenChange={setCreating}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="hqp-room hqp-room-add"
            aria-label={translate('auto.hqPlus.rooms.add', 'New room')}
          >
            +
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="hq-plus-pop w-80 p-3">
          <RoomForm space={null} onDone={() => setCreating(false)} />
        </PopoverContent>
      </Popover>
    </div>
  )
}
