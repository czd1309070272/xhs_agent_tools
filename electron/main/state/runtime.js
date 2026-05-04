module.exports = {
  mainWindow: null,
  activeRun: null,
  loginSession: null,
  latestLoginScreenshot: null,
  internalLogs: [],
  loginState: {
    status: 'checking',
    message: '正在检查本地登录状态...',
    hasBrowserDataDir: false,
    isLoggedIn: false,
    isRunning: false,
    browserVisible: false
  }
};
