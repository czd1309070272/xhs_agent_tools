const { ipcMain, shell } = require('electron');

const {
  readPreviewResultsFile,
  writePreviewResultsFile,
  readPostsFromStore,
  deletePostsFromStore
} = require('../services/storageService');
const { readTaskHistoryFile } = require('../services/taskHistoryService');
const { buildAiConfigSnapshot, saveAiConfig } = require('../services/aiConfigService');
const { getScheduledTaskSnapshot, saveDailyTask } = require('../services/scheduledTaskService');
const {
  listDailyReports,
  getDailyReport,
  getPostsByReport
} = require('../services/dailyReportService');
const {
  refreshLoginStateFromDisk,
  startLoginFlow,
  setLoginBrowserVisibility,
  deleteXhsBrowserData,
  getAccountPoolSnapshot,
  createAccount,
  setActiveAccount,
  removeAccount,
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
    const scheduledTasks = getScheduledTaskSnapshot();
    emitInternalLog(
      sampleResults.length > 0 ? 'info' : 'warn',
      'bootstrap',
      `初始状态加载完成：preview=${previewResults.length}, library=${sampleResults.length}, history=${taskHistory.length}, scheduled=${scheduledTasks.tasks.length}`
    );
    return {
      previewResults,
      sampleResults,
      taskHistory,
      internalLogs: getInternalLogs(),
      xhsLogin: getLoginSnapshot(),
      aiConfig: buildAiConfigSnapshot(),
      scheduledTasks: scheduledTasks.tasks,
      activeDailyTask: scheduledTasks.primaryTask
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

  ipcMain.handle('xhs:start-login', async (_event, payload) => startLoginFlow(payload || {}));
  ipcMain.handle('xhs:set-browser-visibility', async (_event, visible) => setLoginBrowserVisibility(Boolean(visible)));
  ipcMain.handle('xhs:delete-account', async (_event, accountId) => deleteXhsBrowserData(accountId));
  ipcMain.handle('xhs:list-accounts', async () => ({
    ok: true,
    accountPool: getAccountPoolSnapshot()
  }));
  ipcMain.handle('xhs:create-account', async (_event, payload) => {
    try {
      return {
        ok: true,
        account: createAccount(payload || {}),
        accountPool: getAccountPoolSnapshot()
      };
    } catch (error) {
      emitInternalLog('warn', 'xhs-login', `创建账号失败：${error.message}`);
      return { ok: false, error: error.message, accountPool: getAccountPoolSnapshot() };
    }
  });
  ipcMain.handle('xhs:set-active-account', async (_event, accountId) => {
    try {
      return {
        ok: true,
        account: setActiveAccount(accountId),
        accountPool: getAccountPoolSnapshot(),
        xhsLogin: getLoginSnapshot()
      };
    } catch (error) {
      emitInternalLog('warn', 'xhs-login', `切换账号失败：${error.message}`);
      return { ok: false, error: error.message, accountPool: getAccountPoolSnapshot() };
    }
  });
  ipcMain.handle('xhs:remove-account', async (_event, accountId) => {
    try {
      return await removeAccount(accountId);
    } catch (error) {
      emitInternalLog('warn', 'xhs-login', `删除账号失败：${error.message}`);
      return { ok: false, error: error.message, accountPool: getAccountPoolSnapshot() };
    }
  });
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
  ipcMain.handle('schedule:save-daily-task', async (_event, payload) => {
    try {
      return {
        ok: true,
        task: await saveDailyTask(payload || {})
      };
    } catch (error) {
      emitInternalLog('warn', 'schedule', `每日任务保存失败：${error.message}`);
      return {
        ok: false,
        error: error.message,
        task: null
      };
    }
  });
  ipcMain.handle('agent:start-run', async (_event, payload) => {
    await startPythonRun(payload || {});
    return { ok: true };
  });
  ipcMain.handle('agent:cancel-run', async () => ({ ok: cancelRun() }));
  ipcMain.handle('report:list', async () => {
    try {
      emitInternalLog('info', 'report', '开始读取报告列表...');
      const reports = listDailyReports();
      emitInternalLog('success', 'report', `报告列表读取成功：${reports.length} 份报告`);
      return {
        ok: true,
        reports: reports
      };
    } catch (error) {
      emitInternalLog('warn', 'report', `报告列表读取失败：${error.message}`);
      return {
        ok: false,
        error: error.message,
        reports: []
      };
    }
  });
  ipcMain.handle('report:get', async (_event, reportId) => {
    try {
      return {
        ok: true,
        report: getDailyReport(reportId)
      };
    } catch (error) {
      emitInternalLog('warn', 'report', `报告详情读取失败：${error.message}`);
      return {
        ok: false,
        error: error.message,
        report: null
      };
    }
  });
  ipcMain.handle('report:get-posts', async (_event, reportId) => {
    try {
      return {
        ok: true,
        posts: getPostsByReport(reportId)
      };
    } catch (error) {
      emitInternalLog('warn', 'report', `报告帖子读取失败：${error.message}`);
      return {
        ok: false,
        error: error.message,
        posts: []
      };
    }
  });
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
