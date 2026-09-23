import type { BrowserWindow } from 'electron'
import type {
  LinuxPackageInstallInstructions,
  UpdateCheckOptions,
  UpdateStatus
} from '../../shared/updater/update-status-types'
import type {
  RemoteServerUpdateInstallResult,
  RemoteServerUpdaterSnapshot,
  RemoteServerUpdateSupport
} from '../../shared/remote-runtime/host-catalog/remote-server-update'
import type { ReleaseBuild, ReleaseChannel } from '../../shared/updater/release-channel'
import type { ReleaseBuildListOptions } from './releases/updater-release-build-cache'
import { UpdaterSetup, type UpdaterSetupOptions } from './lifecycle/updater-setup'
import { ORCA_PLUS_STOCK_UPDATES_DISABLED } from '../orca-plus/orca-plus-packaged-identity'
import type { UpdateInstallMode } from './lifecycle/updater-state'
import { setDesktopReportUpdateStatus } from '../orca-profiles/cloud-auth/desktop-client-report'

const updater = new UpdaterSetup()
setDesktopReportUpdateStatus(() => updater.getUpdateStatus())

export function resolveUpdateInstallMode(isServeMode: boolean): UpdateInstallMode {
  return updater.resolveUpdateInstallMode(isServeMode)
}

export function getUpdateStatus(): UpdateStatus {
  return updater.getUpdateStatus()
}

export function getRemoteServerUpdateSupport(): RemoteServerUpdateSupport {
  return updater.getRemoteServerUpdateSupport()
}

export function getRemoteServerUpdaterSnapshot(runtimeId: string): RemoteServerUpdaterSnapshot {
  return updater.getRemoteServerUpdaterSnapshot(runtimeId)
}

export function checkForRemoteServerUpdate(
  runtimeId: string,
  options?: UpdateCheckOptions
): RemoteServerUpdaterSnapshot {
  return updater.checkForRemoteServerUpdate(runtimeId, options)
}

export function downloadRemoteServerUpdate(runtimeId: string): RemoteServerUpdaterSnapshot {
  return updater.downloadRemoteServerUpdate(runtimeId)
}

export function installRemoteServerUpdate(runtimeId: string): RemoteServerUpdateInstallResult {
  return updater.installRemoteServerUpdate(runtimeId)
}

export function checkForUpdates(): void {
  if (ORCA_PLUS_STOCK_UPDATES_DISABLED) {
    return
  }
  updater.checkForUpdates()
}

export function checkForUpdatesFromMenu(options?: UpdateCheckOptions): void {
  if (ORCA_PLUS_STOCK_UPDATES_DISABLED) {
    return
  }
  updater.checkForUpdatesFromMenu(options)
}

export function applyAutomaticUpdatesSetting(enabled: boolean | undefined): void {
  if (enabled === true) {
    updater.applyAutomaticUpdatesSetting()
  }
}

export function downloadUpdate(): void {
  if (ORCA_PLUS_STOCK_UPDATES_DISABLED) {
    return
  }
  updater.downloadUpdate()
}

export function quitAndInstall(): void {
  updater.quitAndInstall()
}

export function snoozeRequiredUpdate(): Promise<void> {
  return updater.snoozeRequiredUpdate()
}

export function isQuittingForUpdate(): boolean {
  return updater.isQuittingForUpdate()
}

export function isNativeUpdateInstallUnderWay(): boolean {
  return updater.isNativeUpdateInstallUnderWay()
}

export function applyTeamPolicyBeforeQuit(): void {
  updater.applyTeamPolicyBeforeQuit()
}

export async function getLinuxPackageInstallInstructions(): Promise<LinuxPackageInstallInstructions> {
  return updater.getLinuxPackageInstallInstructions()
}

export async function showLinuxPackage(): Promise<void> {
  return updater.showLinuxPackage()
}

export async function listAvailableReleaseBuilds(
  channel: ReleaseChannel,
  options?: ReleaseBuildListOptions
): Promise<ReleaseBuild[]> {
  return updater.listAvailableReleaseBuilds(channel, options)
}

export function dismissNudge(): void {
  updater.dismissNudge()
}

export function dismissAvailableUpdate(): void {
  updater.dismissAvailableUpdate()
}

export function setupAutoUpdater(
  mainWindow: BrowserWindow | null,
  opts?: UpdaterSetupOptions
): void {
  // Why: custom build (orca-plus-packaging); stock Orca's feed would overwrite Orca+.
  if (ORCA_PLUS_STOCK_UPDATES_DISABLED) {
    return
  }
  updater.setupAutoUpdater(mainWindow, opts)
}
