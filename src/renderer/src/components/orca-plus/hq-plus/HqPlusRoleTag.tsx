// Custom build (hq-chat-roles, owner 14.11): a chat's role in a lead's work, before its title in HQ+ —
// LEAD and SUB-LEAD filled, W and REVIEW outlined. The title drops its own «W · » so it is not said twice.
import {
  hqChatRoleLabel,
  hqStripRoleLabel,
  type HqChatRole
} from '../../../../../shared/hq-chat-role'

export function HqPlusRoleTag({
  role
}: {
  role: HqChatRole | null | undefined
}): React.JSX.Element | null {
  return role ? (
    <span className="hqp-role" data-role={role}>
      {hqChatRoleLabel(role)}
    </span>
  ) : null
}

/** The title shown beside a role tag: without a leading role label of its own. */
export function hqPlusRoleTitle(title: string, role: HqChatRole | null | undefined): string {
  return role ? hqStripRoleLabel(title) || title : title
}
