import { useEffect, useState } from 'react'
import {
  buildBackgroundOverlayCss,
  normalizeCustomAppearanceBackground
} from '../../../shared/custom-appearance-background'
import { createAdoptedSheetSlot } from '@/lib/custom-appearance/adopted-sheet-slot'
import { isWebClientLocation } from '@/lib/web-client-location'
import { useAppStore } from '../store'

const applyBackgroundSheet = createAdoptedSheetSlot()

const MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif'
}

function useBackgroundImageUrl(fileName: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!fileName) {
      setUrl(null)
      return
    }
    let objectUrl: string | null = null
    let disposed = false
    void window.api.customAppearanceBackground
      .read(fileName)
      .then((bytes) => {
        if (disposed || !bytes) {
          return
        }
        const type = MIME_BY_EXTENSION[fileName.split('.').pop() ?? ''] ?? 'image/png'
        objectUrl = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type }))
        setUrl(objectUrl)
      })
      .catch((error: unknown) => console.warn('[custom-appearance] background failed', error))
    return () => {
      disposed = true
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
      }
    }
  }, [fileName])
  return url
}

/** Custom build (appearance-background): draws the chosen picture over the window. */
export function useCustomAppearanceBackground(): void {
  const enabled = useAppStore(
    (s) => s.settings?.customAppearanceEnabled === true && !isWebClientLocation()
  )
  const raw = useAppStore((s) => s.settings?.customAppearanceBackground)
  const background = enabled ? normalizeCustomAppearanceBackground(raw) : null
  const url = useBackgroundImageUrl(background?.fileName ?? null)
  const opacity = background?.opacity
  const blur = background?.blur
  const fileName = background?.fileName

  useEffect(() => {
    if (!url || fileName === undefined || opacity === undefined || blur === undefined) {
      applyBackgroundSheet(document, null)
      return
    }
    applyBackgroundSheet(document, buildBackgroundOverlayCss(url, { fileName, opacity, blur }))
    return () => applyBackgroundSheet(document, null)
  }, [url, fileName, opacity, blur])
}
