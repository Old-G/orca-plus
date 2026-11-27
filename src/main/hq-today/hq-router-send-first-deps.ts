// Custom build (hq-router send first, router v2 T5): the middle zone wired to Orca+ — sends go to the
// chat's native session, «не моё» is read from the chats' finished turns, outcomes go to router_log.
import { readHqFinishedChat } from '../../shared/hq-chat-history'
import { hqRouterSendFirstPrompt } from '../../shared/hq-router-send-first'
import { hqIntakePrompt } from '../../shared/hq-slack-intake'
import { PULSE_BELL_KIND } from '../../shared/pulse-bell'
import { deliverToNativeChat } from '../orca-plus/waiting-replies/deliver-waiting-reply'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import type { HqRouterSendFirstDeps } from './hq-router-send-first'

export /** Router v2 T5: the middle zone's sends and the chats' «не моё», read from their finished turns. */
function hqRouterSendFirstDeps(runtime: OrcaRuntimeService): HqRouterSendFirstDeps {
  return {
    deliver: (chat, card) =>
      deliverToNativeChat(
        chat,
        hqRouterSendFirstPrompt(
          hqIntakePrompt(card, { projectName: card.route?.project ?? card.project, note: '' })
        ),
        'hq-router'
      ),
    finishedTurns: (since) =>
      runtime
        .pulseListInbox(true, { kind: PULSE_BELL_KIND.agentFinished, since })
        .flatMap((item) => {
          const turn = readHqFinishedChat(item)
          return turn?.sessionId
            ? [
                {
                  chat: turn.sessionId,
                  at: turn.finishedAt,
                  text: turn.fullMessage ?? turn.lastMessage
                }
              ]
            : []
        }),
    rewriteOutcome: (key, input) => runtime.pulseRouter().rewriteAutoOutcome(key, input),
    reopenOutcome: (key, reason) => runtime.pulseRouter().reopenAutoOutcome(key, reason),
    unmarkAuto: (key) => runtime.pulseRouter().unmarkAutoRoute(key),
    now: Date.now
  }
}
