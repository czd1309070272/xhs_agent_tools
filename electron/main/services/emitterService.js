const runtime = require('../state/runtime');
const MAX_INTERNAL_LOGS = 200;

function emitToRenderer(channel, payload) {
  if (!runtime.mainWindow || runtime.mainWindow.isDestroyed()) {
    return;
  }

  runtime.mainWindow.webContents.send(channel, payload);
}

function emitLog(level, message) {
  emitToRenderer('agent:log', {
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    level,
    message,
    timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false })
  });
}

function emitInternalLog(level, source, message, details = null) {
  const entry = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    level,
    source,
    message,
    details,
    timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false })
  };

  runtime.internalLogs = [entry, ...runtime.internalLogs].slice(0, MAX_INTERNAL_LOGS);
  emitToRenderer('app:internal-log', entry);
}

function getInternalLogs() {
  return runtime.internalLogs.slice();
}

module.exports = {
  emitToRenderer,
  emitLog,
  emitInternalLog,
  getInternalLogs
};
