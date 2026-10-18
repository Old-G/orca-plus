// Custom build (hq-notes-dedup): «Выгрузка за март готова?» and «готовность выгрузки за март» are the
// same note. Word stems are compared, so word order and endings do not matter; differing numbers
// (MR !215 vs !222) always keep two notes apart. Meaning-level matches are the agent's job.
import type { PulseWaiting, PulseWaitingInput } from './pulse-types'

const MIN_SIMILARITY = 0.8
const STEM_LENGTH = 5

function words(title: string): string[] {
  return title
    .toLowerCase()
    // ё → е, escaped: the orcad bundle that carries this must stay ASCII.
    .replace(/\u0451/g, '\u0435')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 3 || /^\p{N}+$/u.test(word))
}

function stems(title: string): Set<string> {
  return new Set(
    words(title).map((word) => (/^\p{N}+$/u.test(word) ? word : word.slice(0, STEM_LENGTH)))
  )
}

function numbers(title: string): string {
  return words(title)
    .filter((word) => /^\p{N}+$/u.test(word))
    .sort()
    .join(' ')
}

/** Dice coefficient of the two titles' word stems, 0…1. */
export function waitingTitleSimilarity(a: string, b: string): number {
  const left = stems(a)
  const right = stems(b)
  if (left.size === 0 || right.size === 0) {
    return a.trim().toLowerCase() === b.trim().toLowerCase() ? 1 : 0
  }
  let shared = 0
  for (const stem of left) {
    if (right.has(stem)) {
      shared += 1
    }
  }
  return (2 * shared) / (left.size + right.size)
}

/** The open waiting about the same person that says the same thing, if one exists. */
export function findDuplicateWaiting(
  open: readonly PulseWaiting[],
  input: Pick<PulseWaitingInput, 'title' | 'personId'>
): PulseWaiting | null {
  const personId = input.personId ?? null
  return (
    open.find(
      (waiting) =>
        waiting.status === 'open' &&
        waiting.personId === personId &&
        numbers(waiting.title) === numbers(input.title) &&
        waitingTitleSimilarity(waiting.title, input.title) >= MIN_SIMILARITY
    ) ?? null
  )
}
