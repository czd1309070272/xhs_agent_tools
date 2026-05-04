const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopApi', {
  getInitialState: () => ipcRenderer.invoke('app:get-initial-state'),
  clearPreviewResults: () => ipcRenderer.invoke('app:clear-preview-results'),
  deleteLibraryPosts: (postIds) => ipcRenderer.invoke('library:delete-posts', postIds),
  startXhsLogin: () => ipcRenderer.invoke('xhs:start-login'),
  setXhsBrowserVisibility: (visible) => ipcRenderer.invoke('xhs:set-browser-visibility', visible),
  deleteXhsAccount: () => ipcRenderer.invoke('xhs:delete-account'),
  saveAiConfig: (payload) => ipcRenderer.invoke('ai:save-config', payload),
  startRun: (payload) => ipcRenderer.invoke('agent:start-run', payload),
  cancelRun: () => ipcRenderer.invoke('agent:cancel-run'),
  openExternal: (targetUrl) => ipcRenderer.invoke('app:open-external', targetUrl),
  onXhsLoginState: createEventSubscriber('xhs:login-state'),
  onXhsLoginScreenshot: createEventSubscriber('xhs:login-screenshot'),
  onLog: createEventSubscriber('agent:log'),
  onAgentStatus: createEventSubscriber('agent:status'),
  onInternalLog: createEventSubscriber('app:internal-log'),
  onCompleted: createEventSubscriber('agent:completed')
});

function createEventSubscriber(channel) {
  return (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  };
}
