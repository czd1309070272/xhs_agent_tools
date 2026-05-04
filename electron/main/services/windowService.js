const { BrowserWindow } = require('electron');
const fs = require('node:fs');

const constants = require('../config/constants');
const runtime = require('../state/runtime');
const { emitInternalLog } = require('./emitterService');

function createMainWindow() {
  runtime.mainWindow = new BrowserWindow({
    ...constants.WINDOW_OPTIONS,
    webPreferences: {
      preload: constants.PRELOAD_ENTRY,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  emitInternalLog('info', 'window', `创建主窗口，preload=${constants.PRELOAD_ENTRY}`);
  runtime.mainWindow.setMenuBarVisibility(false);
  runtime.mainWindow.webContents.on('did-finish-load', () => {
    emitInternalLog('success', 'window', 'Renderer 页面加载完成。');
    runtime.mainWindow.webContents.executeJavaScript(
      `JSON.stringify({ hasDesktopApi: typeof window.desktopApi !== 'undefined' })`,
      true
    )
      .then((payload) => {
        let preloadStatus = null;
        try {
          if (fs.existsSync(constants.PRELOAD_STATUS_FILE)) {
            preloadStatus = JSON.parse(fs.readFileSync(constants.PRELOAD_STATUS_FILE, 'utf8'));
          }
        } catch (error) {
          preloadStatus = { ok: false, stage: 'status-file-read-failed', message: error.message };
        }

        const result = JSON.parse(payload);
        emitInternalLog(
          result.hasDesktopApi ? 'success' : 'error',
          'window',
          `Renderer 检查 desktopApi=${result.hasDesktopApi}`,
          preloadStatus
        );
      })
      .catch((error) => {
        emitInternalLog('error', 'window', '执行 renderer 诊断脚本失败。', error.message);
      });
  });
  runtime.mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    emitInternalLog('error', 'window', `Renderer 加载失败：${errorCode} ${errorDescription}`);
  });
  runtime.mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (level >= 2) {
      emitInternalLog('warn', 'renderer-console', `${message} @ ${sourceId || 'unknown'}:${line}`);
    }
  });
  runtime.mainWindow.webContents.on('render-process-gone', (_event, details) => {
    emitInternalLog('error', 'window', 'Renderer 进程异常退出。', details);
  });
  runtime.mainWindow.loadFile(constants.RENDERER_ENTRY);
  return runtime.mainWindow;
}

module.exports = {
  createMainWindow
};
