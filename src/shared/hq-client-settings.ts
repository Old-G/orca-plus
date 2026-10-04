// Custom build (hq): the Orca+ settings HQ reads, as the paired web client receives them.
import type { CustomBuildSettings } from './custom-build-settings'

export type HqClientSettings = Pick<
  CustomBuildSettings,
  'hqPath' | 'hqProjectClickUpLists' | 'hqDeferredAfterMinutes' | 'hqDeferredDismissed'
>

/** The HQ settings a paired client may change. */
export const HQ_CLIENT_WRITABLE_SETTING_KEYS = [
  'hqProjectClickUpLists',
  'hqDeferredDismissed'
] as const

export type HqClientSettingsUpdate = Pick<
  HqClientSettings,
  (typeof HQ_CLIENT_WRITABLE_SETTING_KEYS)[number]
>
