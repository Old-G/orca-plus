// Custom build (appearance-background): a picture drawn over the whole window, click-through.

export type CustomAppearanceBackground = {
  /** File inside `<userData>/appearance/`, written by the main process on import. */
  fileName: string
  /** 0–1; the image sits above the UI, so low values read as a tint. */
  opacity: number
  /** Blur radius in px. */
  blur: number
}

export type BackgroundImageErrorCode = 'unsupported' | 'unreadable' | 'too-large' | 'save-failed'

export type BackgroundPickResult = { fileName: string } | { error: BackgroundImageErrorCode } | null

export const BACKGROUND_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif'] as const
export const BACKGROUND_IMAGE_MAX_BYTES = 25 * 1024 * 1024
export const BACKGROUND_DEFAULT_OPACITY = 0.15
export const BACKGROUND_MAX_BLUR_PX = 40

// Why so strict: the renderer passes this name back to main, which must never read outside its folder.
const BACKGROUND_FILE_NAME_RE = /^background-[0-9a-f-]{36}\.(png|jpe?g|webp|gif)$/

export function isBackgroundImageFileName(value: unknown): value is string {
  return typeof value === 'string' && BACKGROUND_FILE_NAME_RE.test(value)
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback
}

export function normalizeCustomAppearanceBackground(
  value: unknown
): CustomAppearanceBackground | null {
  if (typeof value !== 'object' || value === null || !('fileName' in value)) {
    return null
  }
  const record: { fileName: unknown; opacity?: unknown; blur?: unknown } = value
  const { fileName, opacity, blur } = record
  if (!isBackgroundImageFileName(fileName)) {
    return null
  }
  return {
    fileName,
    opacity: clamp(opacity, 0, 1, BACKGROUND_DEFAULT_OPACITY),
    blur: clamp(blur, 0, BACKGROUND_MAX_BLUR_PX, 0)
  }
}

/** The overlay rule; `imageUrl` is a blob: URL the renderer created from the file bytes. */
export function buildBackgroundOverlayCss(
  imageUrl: string,
  background: CustomAppearanceBackground
): string {
  const blur = background.blur > 0 ? `filter: blur(${background.blur}px);` : ''
  return `body::after {
  content: '';
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  pointer-events: none;
  background: url("${imageUrl}") center / cover no-repeat;
  opacity: ${background.opacity};
  ${blur}
}`
}
