// Custom build (hq-chats): the sidebar's project icon in the project's accent — under Orca+'s «New
// view» a project left on the neutral default shows the palette color HQ gives it.
import React from 'react'
import { useAppStore } from '@/store'
import { RepoIconGlyph } from '@/components/repo/repo-icon'
import { DEFAULT_REPO_BADGE_COLOR } from '../../../../shared/repository/appearance/repo-badge-color'
import { projectMarkColors } from '../../../../shared/project-accent-color'

export function ProjectAccentRepoIconGlyph({
  projectId,
  color,
  ...props
}: React.ComponentProps<typeof RepoIconGlyph> & { projectId: string }): React.JSX.Element {
  const repos = useAppStore((state) => state.repos)
  const colorOf = React.useMemo(() => projectMarkColors(repos), [repos])
  // Sync 16: Auto is the sidebar mark's color, so the chip, HQ and the sidebar agree.
  const accent = color?.toLowerCase() === DEFAULT_REPO_BADGE_COLOR ? colorOf(projectId) : color
  return <RepoIconGlyph {...props} color={accent} />
}
