// Custom build (hq-voice-prompts): rewrites a dictation with one short Claude run (no tools — it is the
// owner's words, but the run needs nothing else), and files an idea into HQ/ideas.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  hqIdeaFileName,
  hqVoicePrompt,
  type HqVoiceIdeaResult,
  type HqVoiceRewriteMode,
  type HqVoiceRewriteResult
} from '../../shared/hq-voice-prompts'
import { generateHqText, type HqTextGenerationDeps } from './hq-task-questions'

const TONE_FILE = join('wiki', 'tone.md')
const IDEAS_DIR = 'ideas'

export async function rewriteHqVoiceText(
  request: { mode: HqVoiceRewriteMode; text: string },
  hqPath: string | null,
  deps: HqTextGenerationDeps
): Promise<HqVoiceRewriteResult> {
  const tone =
    request.mode === 'person' && hqPath
      ? await readFile(join(hqPath, TONE_FILE), 'utf8').catch(() => null)
      : null
  return generateHqText(
    hqVoicePrompt(request.mode, request.text, tone),
    { emptyResultName: 'rewritten text', operation: 'hq-voice-rewrite' },
    deps
  )
}

export async function saveHqIdea(
  text: string,
  hqPath: string | null,
  now = new Date()
): Promise<HqVoiceIdeaResult> {
  if (!hqPath) {
    return { ok: false, error: 'No HQ folder is set.' }
  }
  const dir = join(hqPath, IDEAS_DIR)
  await mkdir(dir, { recursive: true })
  const base = hqIdeaFileName(text, now).replace(/\.md$/, '')
  // Why: two ideas with the same title on one day must not overwrite each other.
  for (let attempt = 1; attempt < 100; attempt += 1) {
    const name = attempt === 1 ? `${base}.md` : `${base}-${attempt}.md`
    try {
      await writeFile(join(dir, name), `${text.trim()}\n`, { encoding: 'utf8', flag: 'wx' })
      return { ok: true, path: join(IDEAS_DIR, name) }
    } catch (error) {
      if (!(error instanceof Error && Reflect.get(error, 'code') === 'EEXIST')) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    }
  }
  return { ok: false, error: 'Too many ideas with this title today.' }
}
