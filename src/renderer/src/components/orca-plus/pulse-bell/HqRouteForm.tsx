// Custom build (hq-slack-intake, hq-reply-approve): where a message goes — the project, its chat (or
// a new one), and a few words from the owner for that chat.
import { useMemo } from 'react'
import { useAppStore } from '@/store'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { translate } from '@/i18n/i18n'
import {
  HQ_ROUTE_NEW_CHAT,
  hqProjectChats,
  hqRouteChatValue,
  hqRouteProjects,
  type HqRouteChat
} from './hq-route-targets'

export type HqRoutePinned = { label: string; chats: HqRouteChat[] }

export function HqRouteForm({
  repoId,
  onRepoChange,
  chat,
  onChatChange,
  note,
  onNoteChange,
  pinned,
  disabled,
  portal
}: {
  repoId: string | null
  onRepoChange: (repoId: string) => void
  /** `new`, or `chat:<sessionId>`. */
  chat: string
  onChatChange: (value: string) => void
  note: string
  onNoteChange: (value: string) => void
  /** Chats offered whatever the project, e.g. the ones waiting for this answer. */
  pinned?: HqRoutePinned
  disabled: boolean
  /** Why: inside a toast the lists must open in the toast's own layer, not under it. */
  portal: HTMLElement | null
}): React.JSX.Element {
  const repos = useAppStore((state) => state.repos)
  const worktreesByRepo = useAppStore((state) => state.worktreesByRepo)
  const unifiedTabsByWorktree = useAppStore((state) => state.unifiedTabsByWorktree)
  const settings = useAppStore((state) => state.settings)
  const projects = useMemo(() => hqRouteProjects({ repos }), [repos])
  const chats = useMemo(
    () => hqProjectChats({ repos, worktreesByRepo, unifiedTabsByWorktree, settings }, repoId),
    [repos, worktreesByRepo, unifiedTabsByWorktree, settings, repoId]
  )
  const pinnedIds = new Set(pinned?.chats.map((entry) => entry.sessionId) ?? [])
  const others = chats.filter((entry) => !pinnedIds.has(entry.sessionId)).slice(0, 8)
  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="w-14 shrink-0">{translate('auto.hqRoute.project', 'Project')}</span>
        <Select value={repoId ?? undefined} onValueChange={onRepoChange} disabled={disabled}>
          <SelectTrigger size="sm" className="min-w-0 flex-1">
            <SelectValue placeholder={translate('auto.hqRoute.pickProject', 'Pick a project')} />
          </SelectTrigger>
          <SelectContent position="popper" portalContainer={portal}>
            {projects.map((project) => (
              <SelectItem key={project.repoId} value={project.repoId}>
                {project.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="w-14 shrink-0">{translate('auto.hqRoute.chat', 'Chat')}</span>
        <Select value={chat} onValueChange={onChatChange} disabled={disabled}>
          <SelectTrigger size="sm" className="min-w-0 flex-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" portalContainer={portal}>
            {pinned && pinned.chats.length > 0 ? (
              <SelectGroup>
                <SelectLabel>{pinned.label}</SelectLabel>
                {pinned.chats.map((entry) => (
                  <SelectItem key={entry.sessionId} value={hqRouteChatValue(entry.sessionId)}>
                    {entry.title}
                  </SelectItem>
                ))}
                <SelectSeparator />
              </SelectGroup>
            ) : null}
            <SelectItem value={HQ_ROUTE_NEW_CHAT} disabled={!repoId}>
              {translate('auto.hqRoute.newChat', '+ New chat in this project')}
            </SelectItem>
            {others.map((entry) => (
              <SelectItem key={entry.sessionId} value={hqRouteChatValue(entry.sessionId)}>
                {entry.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <Textarea
        value={note}
        disabled={disabled}
        rows={2}
        className="min-h-14"
        placeholder={translate(
          'auto.hqRoute.notePlaceholder',
          'A few words for the chat (optional)'
        )}
        onChange={(event) => onNoteChange(event.target.value)}
        aria-label={translate('auto.hqRoute.note', 'Note for the chat')}
      />
    </div>
  )
}
