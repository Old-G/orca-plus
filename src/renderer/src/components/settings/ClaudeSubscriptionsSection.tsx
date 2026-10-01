import { useCallback, useEffect, useState } from 'react'
import { LogIn, Loader2, Plus, Trash2 } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import {
  BASE_CLAUDE_SUBSCRIPTION_ID,
  type ClaudeSubscription,
  type ClaudeSubscriptionStatus
} from '../../../../shared/claude-subscriptions'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { ClaudeIcon } from '../status-bar/icons'
import { SearchableSetting } from './SearchableSetting'

type Props = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

function slugId(label: string, taken: readonly ClaudeSubscription[]): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'subscription'
  let id = base === BASE_CLAUDE_SUBSCRIPTION_ID ? `${base}-1` : base
  for (let n = 2; taken.some((existing) => existing.id === id); n++) {
    id = `${base}-${n}`
  }
  return id
}

function describeStatus(status: ClaudeSubscriptionStatus | undefined): string {
  if (!status) {
    return translate('auto.claudeSubscriptions.statusChecking', 'Checking sign-in…')
  }
  if (!status.loggedIn) {
    return translate('auto.claudeSubscriptions.statusSignedOut', 'Not signed in')
  }
  return [status.email, status.orgName, status.subscriptionType].filter(Boolean).join(' · ')
}

export function ClaudeSubscriptionsSection({ settings, updateSettings }: Props): React.JSX.Element {
  const subscriptions = settings.claudeSubscriptions ?? []
  const defaultId = settings.defaultClaudeSubscriptionId ?? BASE_CLAUDE_SUBSCRIPTION_ID
  const [statusById, setStatusById] = useState<Record<string, ClaudeSubscriptionStatus>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [labelDraft, setLabelDraft] = useState('')
  const [dirDraft, setDirDraft] = useState('')

  const loadStatus = useCallback(async (id: string): Promise<void> => {
    try {
      const status = await window.api.claudeSubscriptions.status({ id })
      setStatusById((current) => ({ ...current, [id]: status }))
    } catch {
      setStatusById((current) => ({ ...current, [id]: { loggedIn: false } }))
    }
  }, [])

  const subscriptionIds = subscriptions.map((subscription) => subscription.id).join('\n')
  useEffect(() => {
    for (const id of subscriptionIds.split('\n').filter(Boolean)) {
      void loadStatus(id)
    }
  }, [loadStatus, subscriptionIds])

  const signIn = async (id: string): Promise<void> => {
    setBusyId(id)
    try {
      const status = await window.api.claudeSubscriptions.login({ id })
      setStatusById((current) => ({ ...current, [id]: status }))
    } catch (error) {
      console.error('Claude subscription sign-in failed:', error)
      await loadStatus(id)
    } finally {
      setBusyId(null)
    }
  }

  const add = (): void => {
    const label = labelDraft.trim()
    const configDir = dirDraft.trim()
    if (!label || !configDir) {
      return
    }
    // Main normalizes the dir (expands ~, refuses ~/.claude) and drops an invalid row.
    updateSettings({
      claudeSubscriptions: [
        ...subscriptions,
        { id: slugId(label, subscriptions), label, configDir }
      ]
    })
    setLabelDraft('')
    setDirDraft('')
  }

  const remove = (id: string): void => {
    updateSettings({
      claudeSubscriptions: subscriptions.filter((subscription) => subscription.id !== id),
      ...(defaultId === id ? { defaultClaudeSubscriptionId: null } : {})
    })
  }

  const rows = [
    {
      id: BASE_CLAUDE_SUBSCRIPTION_ID,
      label: translate('auto.claudeSubscriptions.baseLabel', 'Main sign-in'),
      detail: translate(
        'auto.claudeSubscriptions.baseDetail',
        '~/.claude, with the account switcher above'
      ),
      removable: false
    },
    ...subscriptions.map((subscription) => ({
      id: subscription.id,
      label: subscription.label,
      detail: `${subscription.configDir} · ${describeStatus(statusById[subscription.id])}`,
      removable: true
    }))
  ]

  return (
    <section key="claude-subscriptions" id="accounts-claude-subscriptions" className="space-y-4">
      <SearchableSetting
        title={translate('auto.claudeSubscriptions.title', 'Claude subscriptions per session')}
        description={translate(
          'auto.claudeSubscriptions.description',
          'Each subscription is its own Claude config folder with its own sign-in, so sessions on different subscriptions run side by side. Settings, hooks, skills, plugins and history are shared with ~/.claude; sign-in is not.'
        )}
        keywords={['claude', 'subscription', 'organization', 'config dir', 'CLAUDE_CONFIG_DIR']}
        className="space-y-3 py-2"
      >
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <ClaudeIcon size={14} />
            <Label>
              {translate('auto.claudeSubscriptions.title', 'Claude subscriptions per session')}
            </Label>
          </div>
          <p className="text-xs text-muted-foreground">
            {translate(
              'auto.claudeSubscriptions.description',
              'Each subscription is its own Claude config folder with its own sign-in, so sessions on different subscriptions run side by side. Settings, hooks, skills, plugins and history are shared with ~/.claude; sign-in is not.'
            )}
          </p>
        </div>

        <div className="space-y-2">
          {rows.map((row) => {
            const isDefault = row.id === defaultId
            return (
              <div
                key={row.id}
                className={cn(
                  'flex items-center justify-between gap-3 rounded-md border px-3 py-2.5 max-md:flex-col max-md:items-start',
                  isDefault ? 'border-foreground/20 bg-accent/15' : 'border-border/70'
                )}
              >
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-medium">{row.label}</span>
                    {isDefault ? (
                      <Badge variant="outline">
                        {translate('auto.claudeSubscriptions.default', 'Default')}
                      </Badge>
                    ) : null}
                  </div>
                  <span className="truncate text-[11px] text-muted-foreground">{row.detail}</span>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {isDefault ? null : (
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() =>
                        updateSettings({
                          defaultClaudeSubscriptionId:
                            row.id === BASE_CLAUDE_SUBSCRIPTION_ID ? null : row.id
                        })
                      }
                    >
                      {translate('auto.claudeSubscriptions.makeDefault', 'Make default')}
                    </Button>
                  )}
                  {row.removable ? (
                    <>
                      <Button
                        variant="ghost"
                        size="xs"
                        disabled={busyId !== null}
                        onClick={() => void signIn(row.id)}
                      >
                        {busyId === row.id ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <LogIn className="size-3" />
                        )}
                        {translate('auto.claudeSubscriptions.signIn', 'Sign in')}
                      </Button>
                      <Button
                        variant="ghost"
                        size="xs"
                        disabled={busyId !== null}
                        onClick={() => remove(row.id)}
                      >
                        <Trash2 className="size-3" />
                        {translate('auto.claudeSubscriptions.remove', 'Remove')}
                      </Button>
                    </>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>

        <div className="flex items-center gap-2 max-md:flex-col max-md:items-stretch">
          <Input
            value={labelDraft}
            onChange={(event) => setLabelDraft(event.target.value)}
            placeholder={translate('auto.claudeSubscriptions.labelPlaceholder', 'Name, e.g. Work')}
            className="h-7"
          />
          <Input
            value={dirDraft}
            onChange={(event) => setDirDraft(event.target.value)}
            placeholder="~/.claude-work"
            className="h-7"
          />
          <Button
            variant="outline"
            size="xs"
            onClick={add}
            disabled={!labelDraft.trim() || !dirDraft.trim()}
            className="shrink-0"
          >
            <Plus className="size-3" />
            {translate('auto.claudeSubscriptions.add', 'Add')}
          </Button>
        </div>
      </SearchableSetting>
    </section>
  )
}
