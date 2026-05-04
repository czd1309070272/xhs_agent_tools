const { ipcMain, shell } = require('electron');

const {
  readPreviewResultsFile,
  writePreviewResultsFile,
  readPostsFromStore,
  deletePostsFromStore
} = require('../services/storageService');
const { readTaskHistoryFile } = require('../services/taskHistoryService');
const { buildAiConfigSnapshot, saveAiConfig } = require('../services/aiConfigService');
const {
  refreshLoginStateFromDisk,
  startLoginFlow,
  setLoginBrowserVisibility,
  deleteXhsBrowserData,
  getLoginSnapshot
} = require('../services/loginService');
const { startPythonRun, cancelRun } = require('../services/searchRunService');
const { emitLog, emitInternalLog, getInternalLogs } = require('../services/emitterService');

function registerIpcHandlers() {
  ipcMain.handle('app:get-initial-state', async () => {
    refreshLoginStateFromDisk();
    const previewResults = readPreviewResultsFile();
    const sampleResults = readPostsFromStore();
    const taskHistory = readTaskHistoryFile();
    emitInternalLog(
      sampleResults.length > 0 ? 'info' : 'warn',
      'bootstrap',
      `初始状态加载完成：preview=${previewResults.length}, library=${sampleResults.length}, history=${taskHistory.length}`
    );
    return {
      previewResults,
      sampleResults,
      taskHistory,
      internalLogs: getInternalLogs(),
      xhsLogin: getLoginSnapshot(),
      aiConfig: buildAiConfigSnapshot()
    };
  });

  ipcMain.handle('app:clear-preview-results', async () => {
    writePreviewResultsFile([]);
    return { ok: true };
  });

  ipcMain.handle('library:delete-posts', async (_event, postIds) => {
    try {
      const result = deletePostsFromStore(postIds);
      return {
        ok: true,
        deletedCount: result.deletedCount,
        posts: result.posts,
        previewResults: result.previewResults
      };
    } catch (error) {
      emitLog('warn', `删除帖子失败：${error.message}`);
      return {
        ok: false,
        error: error.message,
        deletedCount: 0,
        posts: readPostsFromStore(),
        previewResults: readPreviewResultsFile()
      };
    }
  });

  ipcMain.handle('xhs:start-login', async () => startLoginFlow());
  ipcMain.handle('xhs:set-browser-visibility', async (_event, visible) => setLoginBrowserVisibility(Boolean(visible)));
  ipcMain.handle('xhs:delete-account', async () => deleteXhsBrowserData());
  ipcMain.handle('ai:save-config', async (_event, payload) => {
    try {
      return {
        ok: true,
        config: saveAiConfig(payload)
      };
    } catch (error) {
      emitInternalLog('warn', 'ai-config', `AI 配置保存失败：${error.message}`);
      return {
        ok: false,
        error: error.message,
        config: buildAiConfigSnapshot()
      };
    }
  });
  ipcMain.handle('agent:start-run', async (_event, payload) => {
    startPythonRun(payload || {});
    return { ok: true };
  });
  ipcMain.handle('agent:cancel-run', async () => ({ ok: cancelRun() }));
  ipcMain.handle('app:open-external', async (_event, targetUrl) => {
    if (typeof targetUrl !== 'string' || !/^https?:\/\//.test(targetUrl)) {
      return { ok: false };
    }

    await shell.openExternal(targetUrl);
    return { ok: true };
  });
}

module.exports = {
  registerIpcHandlers
};
