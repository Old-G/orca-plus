import type { HqGroupChatResult } from '../../shared/hq-group-chat'

export type HqGroupChatApi = {
  prepare: (projectGroupId: string) => Promise<HqGroupChatResult>
}
