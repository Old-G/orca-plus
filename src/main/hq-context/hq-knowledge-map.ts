// Custom build (hq-plus-context): the knowledge map HQ/wiki/where.md — which source answers which
// kind of question — matched against a question by its words.
import type { HqWhereAnswer } from '../../shared/hq-context'

const WORD = /[\p{L}\p{N}]{3,}/gu

// Why: words every question has would match every row.
const COMMON = new Set(['что', 'как', 'где', 'это', 'мне', 'мой', 'наш', 'the', 'what', 'how'])

/** A word's first five letters, so «ждём» and «ждёт», «задачи» and «задача» meet. */
function stems(text: string): Set<string> {
  return new Set(
    [...text.toLowerCase().matchAll(WORD)]
      .map((match) => match[0])
      .filter((word) => !COMMON.has(word))
      .map((word) => word.slice(0, 5))
  )
}

/** The `| question | where |` rows of the knowledge map, header and rule left out. */
export function parseHqWhere(markdown: string): { question: string; where: string }[] {
  return markdown
    .split('\n')
    .map((line) => /^\|(.+?)\|(.+)\|\s*$/.exec(line.trim()))
    .flatMap((match) => (match ? [{ question: match[1].trim(), where: match[2].trim() }] : []))
    .filter((row) => !/^[-:\s|]+$/.test(row.question) && !/^вопрос$/i.test(row.question))
}

/** The map's three best rows for a question; none when no word meets. */
export function matchHqWhere(markdown: string, question: string): HqWhereAnswer[] {
  const asked = stems(question)
  return parseHqWhere(markdown)
    .map((row) => ({
      ...row,
      score: [...stems(row.question)].filter((stem) => asked.has(stem)).length
    }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
}
