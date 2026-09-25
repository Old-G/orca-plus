import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'

export const clickupApi = {
  connect: (args) => ipcRenderer.invoke('clickup:connect', args),
  disconnect: () => ipcRenderer.invoke('clickup:disconnect'),
  status: () => ipcRenderer.invoke('clickup:status'),
  testConnection: () => ipcRenderer.invoke('clickup:testConnection'),
  selectWorkspace: (args) => ipcRenderer.invoke('clickup:selectWorkspace', args),
  listTasks: (args) => ipcRenderer.invoke('clickup:listTasks', args),
  searchTasks: (args) => ipcRenderer.invoke('clickup:searchTasks', args),
  getTask: (args) => ipcRenderer.invoke('clickup:getTask', args),
  taskComments: (args) => ipcRenderer.invoke('clickup:taskComments', args),
  updateTaskStatus: (args) => ipcRenderer.invoke('clickup:updateTaskStatus', args),
  addTaskComment: (args) => ipcRenderer.invoke('clickup:addTaskComment', args),
  listSpaces: () => ipcRenderer.invoke('clickup:listSpaces'),
  listLists: (args) => ipcRenderer.invoke('clickup:listLists', args),
  listStatuses: (args) => ipcRenderer.invoke('clickup:listStatuses', args)
} satisfies PreloadApi['clickup']
