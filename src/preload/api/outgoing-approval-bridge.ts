import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'

export const outgoingApprovalApi = {
  decide: (draftId, outcome, editedText, choice) =>
    ipcRenderer.invoke('outgoingApproval:decide', draftId, outcome, editedText, choice),
  options: (draftId) => ipcRenderer.invoke('outgoingApproval:options', draftId),
  settleAgentDraft: (draftId, outcome) =>
    ipcRenderer.invoke('outgoingApproval:settleAgentDraft', draftId, outcome)
} satisfies PreloadApi['outgoingApproval']
