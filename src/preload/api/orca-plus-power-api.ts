/** Custom build (paper-theme): the Mac's power source, for the theme «Auto: Paper on battery». */
export type OrcaPlusPowerApi = {
  isOnBattery: () => Promise<boolean>
  onChanged: (callback: (change: { onBattery: boolean }) => void) => () => void
}
