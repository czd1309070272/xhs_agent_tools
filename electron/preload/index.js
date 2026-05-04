const { contextBridge, ipcRenderer } = require('electron');

const { createDesktopApi } = require('./desktopApi');

contextBridge.exposeInMainWorld('desktopApi', createDesktopApi(ipcRenderer));
