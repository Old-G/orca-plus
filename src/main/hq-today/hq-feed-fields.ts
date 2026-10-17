// Custom build (hq-feed): reading the loosely typed files and rows the feed is built from.
export const TITLE_MAX = 300
export const BODY_MAX = 2000

export function clip(value: unknown, max: number): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const flat = value.trim()
  return flat ? flat.slice(0, max) : null
}

export function webUrl(value: unknown): string | null {
  return typeof value === 'string' && /^https:\/\/[^\s]+$/.test(value) ? value.slice(0, 1000) : null
}

export function time(value: unknown, fallback: number): number {
  const at =
    typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : Number.NaN
  return Number.isFinite(at) && at > 0 ? Math.round(at) : fallback
}
