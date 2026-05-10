export function createLoginController({
  elements,
  state,
  desktopApi,
  appendLog,
  updateRunAvailability,
  onAccountPoolChanged = null
}) {
  function normalizeAccountUsername(value) {
    return String(value || '')
      .trim()
      .replace(/\s+/g, '_')
      .replace(/[^\w.-]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  function updateAccountDataDirPreview() {
    const username = normalizeAccountUsername(elements.accountUsernameInput.value);
    elements.accountBrowserDataInput.value = username
      ? `xhs_browser_data_${username}`
      : 'xhs_browser_data_{用户名}';
  }

  function getAccountInitial(account) {
    const name = account.displayName || account.username || '账号';
    return name.slice(0, 1);
  }

  function renderAccountPool(accountPool = state.accountPool) {
    state.accountPool = {
      activeAccountId: accountPool?.activeAccountId || '',
      accounts: Array.isArray(accountPool?.accounts) ? accountPool.accounts : []
    };

    elements.accountPoolMeta.textContent = `当前 ${state.accountPool.accounts.length} 个账号`;
    elements.accountPoolList.replaceChildren();

    if (state.accountPool.accounts.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'login-placeholder account-pool-empty';
      empty.textContent = '还没有账号，请输入用户名后新增登录。';
      elements.accountPoolList.appendChild(empty);
      return;
    }

    state.accountPool.accounts.forEach((account) => {
      const item = document.createElement('article');
      item.className = `account-pool-item${account.isActive ? ' is-active' : ''}`;

      const avatar = document.createElement('div');
      avatar.className = 'account-avatar';
      avatar.textContent = getAccountInitial(account);

      const copy = document.createElement('div');
      copy.className = 'account-pool-copy';
      const name = document.createElement('strong');
      name.textContent = account.displayName || account.username || '未命名账号';
      const dir = document.createElement('span');
      dir.textContent = account.dataDirName || 'xhs_browser_data';
      copy.append(name, dir);

      const status = document.createElement('span');
      status.className = 'status-pill';
      status.textContent = account.isActive
        ? (account.hasBrowserDataDir ? '当前使用' : '当前未登录')
        : (account.hasBrowserDataDir ? '已登录' : '未登录');

      const actions = document.createElement('div');
      actions.className = 'account-pool-actions';

      const setActiveButton = document.createElement('button');
      setActiveButton.className = 'ghost-btn';
      setActiveButton.type = 'button';
      setActiveButton.textContent = '设为当前';
      setActiveButton.disabled = account.isActive || state.loginState.isRunning;
      setActiveButton.addEventListener('click', async () => {
        const result = await desktopApi.setActiveXhsAccount(account.accountId);
        if (result?.ok) {
          renderAccountPool(result.accountPool);
          updateLoginUI(result.xhsLogin || {});
          if (onAccountPoolChanged) {
            onAccountPoolChanged();
          }
        } else if (result?.error) {
          appendLog({
            level: 'warn',
            timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
            message: result.error
          });
        }
      });

      const loginButton = document.createElement('button');
      loginButton.className = 'ghost-btn';
      loginButton.type = 'button';
      loginButton.textContent = account.hasBrowserDataDir ? '重新登录' : '登录';
      loginButton.disabled = state.loginState.isRunning;
      loginButton.addEventListener('click', async () => {
        await desktopApi.startXhsLogin({ accountId: account.accountId });
      });

      const removeButton = document.createElement('button');
      removeButton.className = 'danger-btn';
      removeButton.type = 'button';
      removeButton.textContent = '删除';
      removeButton.disabled = state.loginState.isRunning;
      removeButton.addEventListener('click', async () => {
        if (!window.confirm(`删除账号 ${account.displayName || account.username}？对应浏览器数据目录也会被删除。`)) {
          return;
        }
        const result = await desktopApi.removeXhsAccount(account.accountId);
        if (result?.ok) {
          renderAccountPool(result.accountPool);
          updateLoginUI({});
          if (onAccountPoolChanged) {
            onAccountPoolChanged();
          }
        } else if (result?.error) {
          appendLog({
            level: 'warn',
            timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
            message: result.error
          });
        }
      });

      actions.append(setActiveButton, loginButton, removeButton);
      item.append(avatar, copy, status, actions);
      elements.accountPoolList.appendChild(item);
    });
  }

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
    if (nextState?.accountPool) {
      renderAccountPool(nextState.accountPool);
    }

    const statusTextMap = {
      checking: '检查中',
      needs_login: '未登录',
      login_running: '登录中',
      logged_in: '已登录',
      error: '异常'
    };

    elements.loginStatus.textContent = statusTextMap[state.loginState.status] || '未知状态';
    elements.loginMessage.textContent = state.loginState.message || '等待进一步操作。';
    elements.loginButton.disabled = Boolean(state.loginState.isRunning) || !state.accountPool.activeAccountId;
    elements.loginButton.textContent = state.loginState.isLoggedIn ? '重新打开登录浏览器' : '开始登录';
    elements.addAccountLoginButton.disabled = Boolean(state.loginState.isRunning);
    elements.toggleBrowserButton.disabled = !state.loginState.isRunning;
    elements.toggleBrowserButton.textContent = state.loginState.browserVisible ? '移出屏幕外' : '召回浏览器';
    elements.deleteAccountButton.disabled = state.isDeletingAccount || !state.accountPool.activeAccountId;
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
    elements.accountUsernameInput.addEventListener('input', () => {
      updateAccountDataDirPreview();
    });

    elements.addAccountLoginButton.addEventListener('click', () => {
      const username = normalizeAccountUsername(elements.accountUsernameInput.value);
      if (!username) {
        appendLog({
          level: 'warn',
          timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
          message: '请先填写账号用户名，再新增账号登录。'
        });
        elements.accountUsernameInput.focus();
        return;
      }

      updateAccountDataDirPreview();
      desktopApi.createXhsAccount({ username }).then(async (result) => {
        if (!result?.ok) {
          appendLog({
            level: 'warn',
            timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
            message: result?.error || '账号创建失败。'
          });
          return;
        }
        renderAccountPool(result.accountPool);
        if (onAccountPoolChanged) {
          onAccountPoolChanged();
        }
        elements.accountUsernameInput.value = '';
        updateAccountDataDirPreview();
        await desktopApi.startXhsLogin({ accountId: result.account?.accountId });
      });
      appendLog({
        level: 'info',
        timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
        message: `正在新增账号登录：${username} -> xhs_browser_data_${username}。`
      });
    });

    elements.loginButton.addEventListener('click', async () => {
      if (!state.accountPool.activeAccountId) {
        appendLog({
          level: 'warn',
          timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
          message: '账号池为空，请先新增账号。'
        });
        elements.accountUsernameInput.focus();
        return;
      }
      appendLog({
        level: 'info',
        timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
        message: '正在请求主进程启动小红书登录浏览器。'
      });
      await desktopApi.startXhsLogin({ accountId: state.accountPool.activeAccountId });
    });

    elements.toggleBrowserButton.addEventListener('click', async () => {
      await desktopApi.setXhsBrowserVisibility(!state.loginState.browserVisible);
    });

    elements.deleteAccountButton.addEventListener('click', async () => {
      if (!state.accountPool.activeAccountId) {
        appendLog({
          level: 'warn',
          timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
          message: '账号池为空，没有可清理的账号。'
        });
        return;
      }
      state.isDeletingAccount = true;
      updateLoginUI({});
      appendLog({
        level: 'warn',
        timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
        message: '正在清理本地小红书登录数据。'
      });
      await desktopApi.deleteXhsAccount(state.accountPool.activeAccountId);
      state.isDeletingAccount = false;
      updateLoginUI({});
    });
  }

  return {
    ensurePreviewCountdownTimer,
    updateLoginUI,
    updateLoginScreenshot,
    renderAccountPool,
    bindEvents
  };
}
