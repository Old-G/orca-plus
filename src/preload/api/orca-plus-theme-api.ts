/** Custom build (paper-theme): the theme's Auto modes, kept in main (it sees the charger and the
 *  screen's brightness). */
export type OrcaPlusThemeAutoMode = 'off' | 'battery' | 'brightness'

export type OrcaPlusThemeApi = {
  getAuto: () => Promise<OrcaPlusThemeAutoMode>
  setAuto: (mode: OrcaPlusThemeAutoMode) => Promise<void>
  onAutoChanged: (callback: (mode: OrcaPlusThemeAutoMode) => void) => () => void
}
