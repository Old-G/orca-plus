// Custom build (vscode-theme-import): VS Code themes use #rgb, #rgba, #rrggbb and #rrggbbaa.

export type Rgba = { r: number; g: number; b: number; a: number }

const HEX_RE = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i

export function parseThemeColor(value: unknown): Rgba | null {
  if (typeof value !== 'string') {
    return null
  }
  const match = HEX_RE.exec(value.trim())
  if (!match) {
    return null
  }
  let hex = match[1]
  if (hex.length <= 4) {
    hex = [...hex].map((ch) => ch + ch).join('')
  }
  const channel = (index: number): number => Number.parseInt(hex.slice(index, index + 2), 16)
  return { r: channel(0), g: channel(2), b: channel(4), a: hex.length === 8 ? channel(6) / 255 : 1 }
}

function toHexByte(value: number): string {
  return Math.round(Math.min(255, Math.max(0, value)))
    .toString(16)
    .padStart(2, '0')
}

export function formatHexColor({ r, g, b }: Rgba): string {
  return `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`
}

/** Composites `color` over an opaque `backdrop`; for consumers that reject alpha (xterm themes). */
export function flattenThemeColor(value: unknown, backdrop: Rgba): string | null {
  const color = parseThemeColor(value)
  if (!color) {
    return null
  }
  const mix = (top: number, bottom: number): number => top * color.a + bottom * (1 - color.a)
  return formatHexColor({
    r: mix(color.r, backdrop.r),
    g: mix(color.g, backdrop.g),
    b: mix(color.b, backdrop.b),
    a: 1
  })
}

/** Returns `value` if it is a valid theme color, keeping its alpha (CSS understands #rrggbbaa). */
export function validThemeColor(value: unknown): string | null {
  return typeof value === 'string' && parseThemeColor(value) ? value.trim() : null
}
