export function createLoginController({
  elements,
  state,
  desktopApi,
  appendLog,
  updateRunAvailability
}) {
  function updatePreviewCountdown() {
    if (!state.loginState.isRunning) {
      elements.loginRefreshHint.textContent = state.loginState.isLoggedIn
        ? '登录已完成，无需继续刷新预览'
        : '截图预览未启动';
      return;
    }

    if (!state.previewLastUpdatedAt) {
      elements.loginRefreshHint.textContent = '截图预览已启动，首帧等待中';
      return;
    }

    const elapsedSeconds = Math.floor((Date.now() - state.previewLastUpdatedAt) / 1000);
    const remainingSeconds = Math.max(0, 5 - elapsedSeconds);
    elements.loginRefreshHint.textContent = remainingSeconds > 0
      ? `截图预览每 5 秒刷新一次，下次约 ${remainingSeconds} 秒后更新`
      : '正在获取下一张截图...';
  }

  function ensurePreviewCountdownTimer() {
    if (state.previewCountdownTimer !== null) {
      return;
    }

    state.previewCountdownTimer = window.setInterval(updatePreviewCountdown, 1000);
  }

  function updateLoginUI(nextState) {
    state.loginState = {
      ...state.loginState,
      ...nextState
    };

    const statusTextMap = {
      checking: '检查中',
      needs_login: '未登录',
      login_running: '登录中',
      logged_in: '已登录',
      error: '异常'
    };

    elements.loginStatus.textContent = statusTextMap[state.loginState.status] || '未知状态';
    elements.loginMessage.textContent = state.loginState.message || '等待进一步操作。';
    elements.loginButton.disabled = Boolean(state.loginState.isRunning);
    elements.loginButton.textContent = state.loginState.isLoggedIn ? '重新打开登录浏览器' : '开始登录';
    elements.toggleBrowserButton.disabled = !state.loginState.isRunning;
    elements.toggleBrowserButton.textContent = state.loginState.browserVisible ? '移出屏幕外' : '召回浏览器';
    elements.deleteAccountButton.disabled = state.isDeletingAccount;
    if (!state.loginState.isRunning && !state.loginState.isLoggedIn) {
      state.previewLastUpdatedAt = 0;
    }
    updatePreviewCountdown();
    updateRunAvailability();
  }

  function updateLoginScreenshot(payload) {
    if (!payload || !payload.dataUrl) {
      elements.loginPreviewImage.hidden = true;
      elements.loginPreviewImage.removeAttribute('src');
      elements.loginPlaceholder.hidden = false;
      elements.loginPreviewMeta.textContent = '尚未捕获登录画面';
      state.previewLastUpdatedAt = 0;
      updatePreviewCountdown();
      return;
    }

    elements.loginPreviewImage.src = payload.dataUrl;
    elements.loginPreviewImage.hidden = false;
    elements.loginPlaceholder.hidden = true;
    elements.loginPreviewMeta.textContent = `最近截图时间 ${payload.capturedAt || '未知'}`;
    state.previewLastUpdatedAt = Date.now();
    updatePreviewCountdown();
  }

  function bindEvents() {
    elements.loginButton.addEventListener('click', async () => {
      appendLog({
        level: 'info',
        timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
        message: '正在请求主进程启动小红书登录浏览器。'
      });
      await desktopApi.startXhsLogin();
    });

    elements.toggleBrowserButton.addEventListener('click', async () => {
      await desktopApi.setXhsBrowserVisibility(!state.loginState.browserVisible);
    });

    elements.deleteAccountButton.addEventListener('click', async () => {
      state.isDeletingAccount = true;
      updateLoginUI({});
      appendLog({
        level: 'warn',
        timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
        message: '正在清理本地小红书登录数据。'
      });
      await desktopApi.deleteXhsAccount();
      state.isDeletingAccount = false;
      updateLoginUI({});
    });
  }

  return {
    ensurePreviewCountdownTimer,
    updateLoginUI,
    updateLoginScreenshot,
    bindEvents
  };
}
