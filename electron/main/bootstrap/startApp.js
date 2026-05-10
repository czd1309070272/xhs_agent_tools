const { app, BrowserWindow, Menu } = require('electron');

const { createMainWindow } = require('../services/windowService');
const { registerIpcHandlers } = require('../ipc/registerIpcHandlers');
const { refreshLoginStateFromDisk, finalizeBeforeQuit } = require('../services/loginService');
const { startScheduledTaskScheduler, stopScheduledTaskScheduler } = require('../services/scheduledTaskService');

registerIpcHandlers();

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  refreshLoginStateFromDisk();
  startScheduledTaskScheduler();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('before-quit', async () => {
  stopScheduledTaskScheduler();
  await finalizeBeforeQuit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
