import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import {
  BACKGROUND_IMAGE_EXTENSIONS,
  type BackgroundPickResult
} from '../../shared/custom-appearance-background'
import {
  BackgroundImageError,
  importBackgroundImage,
  readBackgroundImage,
  removeBackgroundImages
} from '../custom-appearance/background-image-store'

function backgroundDir(): string {
  return join(app.getPath('userData'), 'appearance')
}

/** Custom build (appearance-background): pick, read and clear the window background image. */
export function registerCustomAppearanceBackgroundHandlers(): void {
  ipcMain.handle(
    'customAppearance:pickBackground',
    async (event): Promise<BackgroundPickResult> => {
      const options: Electron.OpenDialogOptions = {
        title: 'Choose background image',
        properties: ['openFile'],
        filters: [{ name: 'Image', extensions: [...BACKGROUND_IMAGE_EXTENSIONS] }]
      }
      const window = BrowserWindow.fromWebContents(event.sender)
      const result = window
        ? await dialog.showOpenDialog(window, options)
        : await dialog.showOpenDialog(options)
      const sourcePath = result.filePaths[0]
      if (result.canceled || !sourcePath) {
        return null
      }
      try {
        return { fileName: await importBackgroundImage(sourcePath, backgroundDir()) }
      } catch (error) {
        return { error: error instanceof BackgroundImageError ? error.code : 'save-failed' }
      }
    }
  )
  ipcMain.handle(
    'customAppearance:readBackground',
    async (_event, fileName: unknown): Promise<Uint8Array | null> =>
      typeof fileName === 'string' ? readBackgroundImage(backgroundDir(), fileName) : null
  )
  ipcMain.handle('customAppearance:clearBackground', () => removeBackgroundImages(backgroundDir()))
}
