// Custom build (chat-auto-effort): TypeSafe's Jev on OpenRouter sorts a message into an effort level.
import { AUTO_EFFORT_LEVELS, type AutoEffortLevel } from './native-chat-auto-effort'

const JEV_URL = 'https://openrouter.ai/api/alpha/decisions'
const JEV_MODEL = '~typesafe/jev-latest'
// Why: Jev answers in ~0.8 s but now and then takes 15 s; past this the chat keeps its effort.
const JEV_TIMEOUT_MS = 3000
const STATE_CHARS = 4000

const CRITERIA: Record<AutoEffortLevel, string> = {
  low: "Trivial, nothing to work out: thanks or an acknowledgement ('ok', 'got it'), a yes/no about something the agent just showed, re-checking a status the agent just reported, reading out a value, a typo fix the agent already named.",
  medium:
    'Simple, short or routine: a status check, a quick factual answer, a one-line edit, running a known command, a small follow-up step of an easy task.',
  high: 'Normal engineering work: a contained bug fix or feature in known code, a review, a multi-step task with a clear plan.',
  xhigh:
    "Hard or open-ended: design/architecture, a bug with unknown cause across several systems, research, a large multi-file feature, anything risky. A short approval ('yes', 'go') of a large or risky plan the agent proposed is also xhigh."
}

function isLevel(value: unknown): value is AutoEffortLevel {
  return AUTO_EFFORT_LEVELS.some((level) => level === value)
}

/** Null on any failure or timeout: the caller keeps the effort the chat already has. */
export async function pickEffortWithJev(input: {
  key: string
  message: string
  previousAgentMessage: string | null
  fetchImpl?: typeof fetch
}): Promise<AutoEffortLevel | null> {
  const body = {
    model: JEV_MODEL,
    state: {
      user_message: input.message.slice(0, STATE_CHARS),
      ...(input.previousAgentMessage
        ? { previous_agent_message: input.previousAgentMessage.slice(-STATE_CHARS) }
        : {})
    },
    questions: {
      effort: {
        type: 'choice',
        instructions:
          "How much reasoning effort does the coding agent need to handle the user's message, given the agent's previous message it answers?",
        criteria: CRITERIA
      }
    }
  }
  try {
    const response = await (input.fetchImpl ?? fetch)(JEV_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${input.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(JEV_TIMEOUT_MS)
    })
    if (!response.ok) {
      return null
    }
    const json: unknown = await response.json()
    const answers: unknown = json && typeof json === 'object' ? Reflect.get(json, 'answers') : null
    const effort: unknown =
      answers && typeof answers === 'object' ? Reflect.get(answers, 'effort') : null
    const choice: unknown =
      effort && typeof effort === 'object' ? Reflect.get(effort, 'choice') : null
    return isLevel(choice) ? choice : null
  } catch {
    return null
  }
}
