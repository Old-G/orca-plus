// Custom build (clickup-untagged-nudge): the gate's nudge, fed by the pulse people minus the owner.
import {
  untaggedNudgeReason,
  untaggedPeopleInClickUpComment
} from '../../../shared/outgoing-approval/outgoing-clickup-untagged'
import type { PulsePerson } from '../../../shared/pulse-types'
import { getClickUpViewerId } from '../../clickup/clickup-tasks'

export function untaggedClickUpNudge(
  people: () => PulsePerson[]
): (toolName: string, toolInput: Record<string, unknown>) => string | null {
  let owner: string | null = null
  // Why: the comment goes out as the owner, who names themselves only by accident.
  void getClickUpViewerId()
    .then((id) => {
      owner = id
    })
    .catch(() => {})
  return (toolName, toolInput) => {
    // Why: every gated call passes here; only a ClickUp comment is worth reading the people for.
    if (!/clickup_create_(?:task_)?comment$/.test(toolName)) {
      return null
    }
    try {
      const untagged = untaggedPeopleInClickUpComment(
        toolName,
        toolInput,
        people().filter((person) => !owner || person.clickupUserId !== owner)
      )
      return untagged.length > 0 ? untaggedNudgeReason(untagged) : null
    } catch (error) {
      console.warn('[outgoing-approval] untagged check failed:', error)
      return null
    }
  }
}
