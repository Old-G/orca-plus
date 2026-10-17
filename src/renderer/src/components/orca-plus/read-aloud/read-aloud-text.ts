// Custom build (hq-read-aloud): what «Read aloud» says — the agent's latest answer, as plain sentences
// a voice can read (no code, link targets or markdown marks).
import type { NativeChatMessage } from '../../../../../shared/native-chat-types'

const CHUNK_MAX = 240

/** The answer: the agent's text after its last tool call or the owner's last message. */
export function lastAnswerText(messages: readonly NativeChatMessage[]): string {
  const parts: string[] = []
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role === 'reasoning' || message.role === 'system') {
      continue
    }
    const texts =
      message.role === 'assistant'
        ? message.blocks.flatMap((block) => (block.type === 'text' ? [block.text] : []))
        : []
    const hasTool = message.blocks.some((block) => block.type !== 'text')
    if (message.role !== 'assistant' || (hasTool && parts.length > 0)) {
      break
    }
    if (texts.length > 0) {
      parts.unshift(texts.join('\n'))
    }
  }
  return parts.join('\n\n').trim()
}

/** Markdown as a voice should read it. */
export function speakableText(markdown: string): string {
  return (
    markdown
      .replace(/```[\s\S]*?(```|$)/g, '\n')
      .replace(/`([^`\n]+)`/g, '$1')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/https?:\/\/\S+/g, '')
      .split('\n')
      .map((line) =>
        line
          .replace(/^\s*\|?\s*:?-{3,}.*$/, '')
          .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/, '')
          .replace(/\s*\|\s*/g, ', ')
          .replace(/(\*\*|__|\*|_|~~)(\S[^*_~]*?\S|\S)\1/g, '$2')
          .replace(/^[,\s]+|[,\s]+$/g, '')
          .trim()
      )
      .filter(Boolean)
      // Why: a line without its own stop runs into the next one when read aloud.
      .map((line) => (/[.!?:;…]$/.test(line) ? line : `${line}.`))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
  )
}

/** Sentence-bounded pieces of at most `max` characters: long utterances are where speech engines stall. */
export function speechChunks(text: string, max = CHUNK_MAX): string[] {
  const sentences = text.match(/[^.!?…]+[.!?…]+["»)]*\s*|[^.!?…]+$/g) ?? []
  const chunks: string[] = []
  let current = ''
  for (const sentence of sentences) {
    const next = `${current}${sentence}`
    if (current && next.length > max) {
      chunks.push(current.trim())
      current = sentence
    } else {
      current = next
    }
  }
  if (current.trim()) {
    chunks.push(current.trim())
  }
  return chunks
}
