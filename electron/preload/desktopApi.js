function createDesktopApi(ipcRenderer) {
  return {
    getInitialState: () => ipcRenderer.invoke('app:get-initial-state'),
    clearPreviewResults: () => ipcRenderer.invoke('app:clear-preview-results'),
    deleteLibraryPosts: (postIds) => ipcRenderer.invoke('library:delete-posts', postIds),
    startXhsLogin: (payload) => ipcRenderer.invoke('xhs:start-login', payload),
    setXhsBrowserVisibility: (visible) => ipcRenderer.invoke('xhs:set-browser-visibility', visible),
    deleteXhsAccount: (accountId) => ipcRenderer.invoke('xhs:delete-account', accountId),
    listXhsAccounts: () => ipcRenderer.invoke('xhs:list-accounts'),
    createXhsAccount: (payload) => ipcRenderer.invoke('xhs:create-account', payload),
    setActiveXhsAccount: (accountId) => ipcRenderer.invoke('xhs:set-active-account', accountId),
    removeXhsAccount: (accountId) => ipcRenderer.invoke('xhs:remove-account', accountId),
    saveAiConfig: (payload) => ipcRenderer.invoke('ai:save-config', payload),
    saveDailyTask: (payload) => ipcRenderer.invoke('schedule:save-daily-task', payload),
    startRun: (payload) => ipcRenderer.invoke('agent:start-run', payload),
    cancelRun: () => ipcRenderer.invoke('agent:cancel-run'),
    listReports: () => ipcRenderer.invoke('report:list'),
    getReport: (reportId) => ipcRenderer.invoke('report:get', reportId),
    getReportPosts: (reportId) => ipcRenderer.invoke('report:get-posts', reportId),
    openExternal: (targetUrl) => ipcRenderer.invoke('app:open-external', targetUrl),
    onXhsLoginState: createEventSubscriber(ipcRenderer, 'xhs:login-state'),
    onXhsLoginScreenshot: createEventSubscriber(ipcRenderer, 'xhs:login-screenshot'),
    onLog: createEventSubscriber(ipcRenderer, 'agent:log'),
    onInternalLog: createEventSubscriber(ipcRenderer, 'app:internal-log'),
    onCompleted: createEventSubscriber(ipcRenderer, 'agent:completed')
  };
}

function createEventSubscriber(ipcRenderer, channel) {
  return (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  };
}

module.exports = {
  createDesktopApi
};
