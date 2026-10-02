// Custom build (hq): whether an agent's last answer leaves the next move to the user — a question
// or a request at its end — read from the text alone, no model.
const TAIL_CHARS = 400

// Why: agents here answer in Russian or English; these are the phrasings that hand the turn back.
const ASKS = [
  /\?\s*[)»"'*_`]*\s*$/,
  /(?<![а-яё])(скажи|напиши|ответь|подтверди|одобри|реши|выбери)(?![а-яё])/iu,
  /(?<![а-яё])(жду|ждёт|ждет|нужно от тебя|нужен твой|нужна твоя|нужно твоё|нужно твое|за тобой|на твоё усмотрение|на твое усмотрение)(?![а-яё])/iu,
  /(?<![а-яё])(да или нет|да\/нет)(?![а-яё])/iu,
  /\b(let me know|should i|do you want|want me to|shall i|your call|waiting for you|need your|please (confirm|approve|decide|choose|reply))\b/i
]

function tail(text: string): string {
  const trimmed = text.trim()
  return trimmed.length > TAIL_CHARS ? trimmed.slice(-TAIL_CHARS) : trimmed
}

/** True when the end of the answer asks the user for something. */
export function hqAnswerAsksUser(text: string | null | undefined): boolean {
  if (!text?.trim()) {
    return false
  }
  const end = tail(text)
  return ASKS.some((pattern) => pattern.test(end))
}
