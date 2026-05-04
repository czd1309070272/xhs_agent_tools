const path = require('node:path');
const { app, BrowserWindow, Menu } = require('electron');

const runtime = require('./main/state/runtime');
const { registerIpcHandlers } = require('./main/ipc/registerIpcHandlers');
const { refreshLoginStateFromDisk, finalizeBeforeQuit } = require('./main/services/loginService');

function createWindow() {
  runtime.mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 1100,
    minHeight: 680,
    backgroundColor: '#efe4d2',
    title: 'XHS Agent Desktop',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  runtime.mainWindow.setMenuBarVisibility(false);
  runtime.mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

registerIpcHandlers();

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  refreshLoginStateFromDisk();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('before-quit', async () => {
  await finalizeBeforeQuit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
