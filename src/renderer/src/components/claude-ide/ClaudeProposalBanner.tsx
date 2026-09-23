import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { useShortcutLabel } from '@/hooks/useShortcutLabel'
import {
  acceptClaudeProposal,
  rejectClaudeProposal
} from '@/lib/claude-ide/claude-ide-diff-proposal-state'
import type { OpenFile } from '@/store/slices/editor'

export function ClaudeProposalBanner({ file }: { file: OpenFile }): React.JSX.Element {
  const saveShortcut = useShortcutLabel('editor.save')
  return (
    <div role="status" className="border-b border-border bg-muted/40 px-4 py-2 text-xs">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Sparkles className="size-3.5 shrink-0 text-primary" />
          <span className="min-w-0 truncate font-medium text-foreground">
            {translate(
              'auto.components.claude.ide.ClaudeProposalBanner.title',
              'Claude proposes changes to {{value0}}',
              { value0: file.relativePath }
            )}
          </span>
          <span className="shrink-0 text-muted-foreground">
            {translate(
              'auto.components.claude.ide.ClaudeProposalBanner.hint',
              'Edit the right side before accepting.'
            )}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={() => rejectClaudeProposal(file.id)}
          >
            {translate('auto.components.claude.ide.ClaudeProposalBanner.reject', 'Reject')}
          </Button>
          <Button type="button" size="xs" onClick={() => acceptClaudeProposal(file.id)}>
            {translate('auto.components.claude.ide.ClaudeProposalBanner.accept', 'Accept')}
            <span className="text-primary-foreground/70">{saveShortcut}</span>
          </Button>
        </div>
      </div>
    </div>
  )
}
