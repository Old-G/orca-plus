// Custom build (hq-chats): the sidebar's project icon in the project's accent — under Orca+'s «New
// view» a project left on the neutral default shows the palette color HQ gives it.
import type React from 'react'
import { RepoIconGlyph } from '@/components/repo/repo-icon'
import { DEFAULT_REPO_BADGE_COLOR } from '../../../../shared/constants'
import { projectAccentColor } from '../../../../shared/project-accent-color'

export function ProjectAccentRepoIconGlyph({
  projectId,
  color,
  ...props
}: React.ComponentProps<typeof RepoIconGlyph> & { projectId: string }): React.JSX.Element {
  const accent =
    color?.toLowerCase() === DEFAULT_REPO_BADGE_COLOR ? projectAccentColor(projectId) : color
  return <RepoIconGlyph {...props} color={accent} />
}
