// Custom build (hq-space-keys): each workspace's own tokens — a second Slack, a Telegram bot, another
// ClickUp — saved encrypted on the Mac. A workspace without one uses Orca's own connection.
import { useCallback, useEffect, useState } from 'react'
import {
  HQ_SPACE_KEY_KINDS,
  readHqSpaceKeys,
  type HqSpace,
  type HqSpaceKeyKind
} from '../../../../../shared/hq-spaces'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { translate } from '@/i18n/i18n'

const KIND_LABEL: Record<HqSpaceKeyKind, string> = {
  slack: 'Slack',
  telegram: 'Telegram',
  clickup: 'ClickUp',
  jira: 'Jira',
  trello: 'Trello',
  asana: 'Asana'
}

// Why: Orca connects these itself; for the rest a workspace that uses one needs its own key.
const ORCA_CONNECTED: readonly HqSpaceKeyKind[] = ['slack', 'clickup', 'jira']

// Why: the three the owner's workspaces use or are about to; the rest show once named or saved.
const ALWAYS_SHOWN: readonly HqSpaceKeyKind[] = ['slack', 'telegram', 'clickup']

/** The kinds a workspace's rows show: the usual three, what its yaml names, what it saved. */
export function hqSpaceKeyRows(space: HqSpace, saved: readonly HqSpaceKeyKind[]): HqSpaceKeyKind[] {
  const named = [space.messenger, space.tasks]
  return HQ_SPACE_KEY_KINDS.filter(
    (kind) => ALWAYS_SHOWN.includes(kind) || named.includes(kind) || saved.includes(kind)
  )
}

async function callRuntime(method: string, params?: unknown): Promise<unknown> {
  const response = await window.api.runtime.call({ method, params })
  if (!response.ok) {
    throw new Error(response.error.message)
  }
  return response.result
}

function KeyRow({
  space,
  kind,
  saved,
  onChanged
}: {
  space: HqSpace
  kind: HqSpaceKeyKind
  saved: boolean
  onChanged: () => void
}): React.JSX.Element {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const uses = space.messenger === kind || space.tasks === kind
  const save = (next: string | null): void => {
    setBusy(true)
    setError(null)
    callRuntime('hqProjects.setSpaceKey', { space: space.slug, kind, value: next })
      .then((result) => {
        const failed =
          result && typeof result === 'object' ? Reflect.get(result, 'error') : undefined
        if (typeof failed === 'string') {
          setError(failed)
          return
        }
        setValue('')
        onChanged()
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setBusy(false))
  }
  const status = saved
    ? translate('auto.hq.spaceKeys.saved', 'Own key saved')
    : !uses
      ? translate('auto.hq.spaceKeys.none', 'Not set')
      : ORCA_CONNECTED.includes(kind)
        ? translate('auto.hq.spaceKeys.orca', "Uses Orca's connection")
        : translate('auto.hq.spaceKeys.needed', 'Needed — not set')
  return (
    <li className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className="w-20 shrink-0 text-sm font-medium">{KIND_LABEL[kind]}</span>
        <Input
          type="password"
          value={value}
          disabled={busy}
          onChange={(event) => setValue(event.target.value)}
          placeholder={status}
          aria-label={translate('auto.hq.spaceKeys.input', '{{kind}} key for {{space}}', {
            kind: KIND_LABEL[kind],
            space: space.name
          })}
          className="h-8 flex-1"
        />
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={busy || !value.trim()}
          onClick={() => save(value)}
        >
          {translate('auto.hq.spaceKeys.save', 'Save')}
        </Button>
        {saved ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => save(null)}
          >
            {translate('auto.hq.spaceKeys.remove', 'Remove')}
          </Button>
        ) : null}
      </div>
      {error ? <p className="pl-22 text-xs text-destructive">{error}</p> : null}
    </li>
  )
}

export function HqSpaceKeysDialog({
  open,
  onOpenChange,
  spaces
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  spaces: readonly HqSpace[]
}): React.JSX.Element {
  const [keys, setKeys] = useState<Record<string, HqSpaceKeyKind[]>>({})
  const load = useCallback(() => {
    callRuntime('hqProjects.spaceKeys')
      .then((result) => setKeys(readHqSpaceKeys(result)))
      .catch((error: unknown) => console.warn('[hq] workspace keys failed:', error))
  }, [])
  useEffect(() => {
    if (open) {
      load()
    }
  }, [open, load])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{translate('auto.hq.spaceKeys.title', 'Workspace keys')}</DialogTitle>
          <DialogDescription>
            {translate(
              'auto.hq.spaceKeys.hint',
              "Each workspace's own tokens, encrypted on this Mac. A workspace without one uses Orca's own connection."
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="scrollbar-sleek flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
          {spaces.map((space) => {
            const saved = keys[space.slug] ?? []
            return (
              <section key={space.slug} aria-label={space.name} className="flex flex-col gap-2">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <span
                    aria-hidden="true"
                    className="inline-block size-2 rounded-full"
                    style={{ backgroundColor: space.color }}
                  />
                  {space.name}
                </h3>
                <ul className="flex flex-col gap-1.5">
                  {hqSpaceKeyRows(space, saved).map((kind) => (
                    <KeyRow
                      key={kind}
                      space={space}
                      kind={kind}
                      saved={saved.includes(kind)}
                      onChanged={load}
                    />
                  ))}
                </ul>
              </section>
            )
          })}
        </div>
      </DialogContent>
    </Dialog>
  )
}
