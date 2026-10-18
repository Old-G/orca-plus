// Custom build (hq-chats): «Keep in HQ» in the project menu — the project's latest chats stay on view
// in HQ even after it goes quiet.
import React from 'react'
import { Check, Pin } from 'lucide-react'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import type { Repo } from '../../../../../../shared/repo-types'
import { setHqProjectKept } from '../../../orca-plus/hq/hq-chat-actions'

export function HqKeepProjectMenuItem({ repo }: { repo: Repo }): React.JSX.Element | null {
  const kept = useAppStore((state) => state.settings?.hqKeptProjectIds?.includes(repo.id) === true)
  return (
    <DropdownMenuItem onSelect={() => setHqProjectKept(repo.id, !kept)}>
      <Pin className="size-3.5" />
      {translate('auto.sidebar.keepInHq', 'Keep in HQ')}
      {kept ? <Check className="ml-auto size-3.5" /> : null}
    </DropdownMenuItem>
  )
}
