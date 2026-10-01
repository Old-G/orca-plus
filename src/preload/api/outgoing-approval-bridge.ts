import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'

export const outgoingApprovalApi = {
  decide: (draftId, outcome, editedText) =>
    ipcRenderer.invoke('outgoingApproval:decide', draftId, outcome, editedText)
} satisfies PreloadApi['outgoingApproval']
