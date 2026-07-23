import { contextBridge, ipcRenderer } from 'electron'
import type { AccountCostProfile, AccountUpstreamMapping, AizzzApi, AccountGroupMutation, GroupCapabilityTagId, InternalUserProfile, StationInput, WindowMode, WebAuthInput } from '../shared/types'

const api: AizzzApi = {
  runtime: {
    isBrowserPreview: false
  },
  auth: {
    login: (input: WebAuthInput) => ipcRenderer.invoke('auth:login', input)
  },
  stations: {
    list: () => ipcRenderer.invoke('stations:list'),
    save: (input: StationInput) => ipcRenderer.invoke('stations:save', input),
    remove: (id: string) => ipcRenderer.invoke('stations:remove', id),
    refresh: (id?: string) => ipcRenderer.invoke('stations:refresh', id),
    getSnapshots: () => ipcRenderer.invoke('stations:snapshots'),
    diagnose: (input) => ipcRenderer.invoke('stations:diagnose', input),
    previewMapping: (input) => ipcRenderer.invoke('stations:preview-mapping', input),
    onSnapshotsUpdated: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, snapshots: Awaited<ReturnType<AizzzApi['stations']['getSnapshots']>>) => callback(snapshots)
      ipcRenderer.on('stations:snapshot-updated', listener)
      return () => ipcRenderer.removeListener('stations:snapshot-updated', listener)
    }
  },
  window: {
    setMode: (nextMode: WindowMode) => ipcRenderer.invoke('window:set-mode', nextMode),
    toggleAlwaysOnTop: () => ipcRenderer.invoke('window:toggle-on-top'),
    show: () => ipcRenderer.invoke('window:show'),
    onModeChanged: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, state: { mode: WindowMode; alwaysOnTop: boolean }) => callback(state)
      ipcRenderer.on('window:mode', listener)
      return () => ipcRenderer.removeListener('window:mode', listener)
    }
  },
  admin: {
    updateAccountGroups: (mutation: AccountGroupMutation) => ipcRenderer.invoke('admin:update-account-groups', mutation)
  },
  profit: {
    load: (query) => ipcRenderer.invoke('profit:load', query),
    archive: (query, options) => ipcRenderer.invoke('profit:archive', query, options)
  },
  preferences: {
    get: () => ipcRenderer.invoke('preferences:get'),
    setHiddenGroupKeys: (keys: string[]) => ipcRenderer.invoke('preferences:set-hidden-groups', keys),
    setOperatingExcludedGroupKeys: (keys: string[]) => ipcRenderer.invoke('preferences:set-operating-excluded-groups', keys),
    setManualGroupTags: (tags: Record<string, GroupCapabilityTagId[]>) => ipcRenderer.invoke('preferences:set-manual-group-tags', tags),
    setGroupChangeEvents: (events) => ipcRenderer.invoke('preferences:set-group-change-events', events),
    setDismissedGroupChangeEventIds: (ids: string[]) => ipcRenderer.invoke('preferences:set-dismissed-group-change-event-ids', ids),
    setAccountUpstreamMappings: (mappings: AccountUpstreamMapping[]) => ipcRenderer.invoke('preferences:set-account-upstream-mappings', mappings),
    setAccountCostProfiles: (profiles: AccountCostProfile[]) => ipcRenderer.invoke('preferences:set-account-cost-profiles', profiles),
    setInternalUserProfiles: (profiles: InternalUserProfile[]) => ipcRenderer.invoke('preferences:set-internal-user-profiles', profiles)
  },
  dataCenter: {
    getSummary: () => ipcRenderer.invoke('data-center:get-summary')
  }
}

contextBridge.exposeInMainWorld('aizzz', api)
