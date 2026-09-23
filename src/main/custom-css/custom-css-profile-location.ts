import { join } from 'node:path'
import { app } from 'electron'
import { CUSTOM_CSS_FILE_NAME } from '../../shared/custom-css'

/** Custom build: custom.css lives in this profile's userData, so the stock Orca (~/.orca/custom.css) never loads our theme. */
export function getCustomBuildCustomCssPath(): string {
  return join(app.getPath('userData'), CUSTOM_CSS_FILE_NAME)
}
