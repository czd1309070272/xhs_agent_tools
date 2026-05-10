const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { screen } = require('electron');
const { chromium } = require('playwright');

const constants = require('../config/constants');
const runtime = require('../state/runtime');
const { emitLog, emitToRenderer } = require('./emitterService');
const { browserDataDirExists } = require('./storageService');
const { execPythonModule } = require('./pythonService');

function normalizeAccountUsername(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function resolveAccountDataDirName(username, accountId = '') {
  const normalized = normalizeAccountUsername(username);
  return `xhs_browser_data_${normalized}`;
}

function buildAccount(account = {}) {
  const accountId = String(account.accountId || account.id || '').trim();
  const username = normalizeAccountUsername(account.username || accountId);
  if (!accountId || !username) {
    throw new Error('账号用户名不能为空。');
  }
  const dataDirName = account.dataDirName || resolveAccountDataDirName(username, accountId);
  const dataDir = path.join(constants.WORKSPACE_ROOT, dataDirName);

  return {
    accountId,
    username,
    displayName: account.displayName || username,
    dataDirName,
    dataDir,
    createdAt: account.createdAt || new Date().toISOString(),
    updatedAt: account.updatedAt || new Date().toISOString()
  };
}

function serializeAccount(account, activeAccountId = runtime.activeXhsAccountId) {
  const normalized = buildAccount(account);
  return {
    accountId: normalized.accountId,
    username: normalized.username,
    displayName: normalized.displayName,
    dataDirName: normalized.dataDirName,
    hasBrowserDataDir: browserDataDirExists(normalized.dataDir),
    isActive: normalized.accountId === activeAccountId,
    createdAt: normalized.createdAt,
    updatedAt: normalized.updatedAt
  };
}

function withTempJsonFilePairs(task) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xhs-account-pool-'));
  try {
    return task(tempDir);
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore temp cleanup failures.
    }
  }
}

function execAccountStoreFileCommand(command, payload = null) {
  return withTempJsonFilePairs((tempDir) => {
    const outputFile = path.join(tempDir, 'output.json');
    const args = [command];
    if (payload !== null) {
      const inputFile = path.join(tempDir, 'input.json');
      fs.writeFileSync(inputFile, JSON.stringify(payload, null, 2), 'utf8');
      args.push(inputFile, outputFile);
    } else {
      args.push(outputFile);
    }
    execPythonModule(constants.STORE_MODULE, args, { preferVenv: false });
    return JSON.parse(fs.readFileSync(outputFile, 'utf8'));
  });
}

function ensureAccountPoolLoaded() {
  const stored = execAccountStoreFileCommand('list-xhs-accounts-file');
  const activeAccountId = stored?.activeAccountId || '';
  const accounts = Array.isArray(stored?.accounts) ? stored.accounts : [];
  runtime.xhsAccounts = accounts.map((account) => buildAccount(account));
  runtime.activeXhsAccountId = activeAccountId
    && runtime.xhsAccounts.some((account) => account.accountId === activeAccountId)
    ? activeAccountId
    : (runtime.xhsAccounts[0]?.accountId || '');
  return getAccountPoolSnapshot();
}

function getActiveAccount() {
  ensureAccountPoolLoaded();
  return runtime.xhsAccounts.find((account) => account.accountId === runtime.activeXhsAccountId) || null;
}

function getAccountById(accountId) {
  ensureAccountPoolLoaded();
  return runtime.xhsAccounts.find((account) => account.accountId === accountId) || null;
}

function getAccountPoolSnapshot() {
  const accounts = runtime.xhsAccounts.length > 0 ? runtime.xhsAccounts : [];
  const activeAccountId = runtime.activeXhsAccountId || '';
  return {
    activeAccountId,
    accounts: accounts.map((account) => serializeAccount(account, activeAccountId))
  };
}

function createAccount(input = {}) {
  ensureAccountPoolLoaded();
  const username = normalizeAccountUsername(input.username);
  if (!username) {
    throw new Error('账号用户名不能为空。');
  }

  const accountId = username;
  const existing = runtime.xhsAccounts.find((account) => account.accountId === accountId);
  if (existing) {
    return setActiveAccount(existing.accountId);
  }

  const account = buildAccount({
    accountId,
    username,
    displayName: input.displayName || username,
    dataDirName: resolveAccountDataDirName(username, accountId)
  });
  const saved = execAccountStoreFileCommand('upsert-xhs-account-file', {
    accountId: account.accountId,
    username: account.username,
    displayName: account.displayName,
    dataDirName: account.dataDirName,
    setActive: true
  });
  ensureAccountPoolLoaded();
  return serializeAccount(saved);
}

function setActiveAccount(accountId) {
  ensureAccountPoolLoaded();
  const selected = getAccountById(accountId);
  if (!selected) {
    throw new Error('账号不存在。');
  }
  execAccountStoreFileCommand('set-active-xhs-account-file', { accountId: selected.accountId });
  ensureAccountPoolLoaded();
  refreshLoginStateFromDisk();
  return serializeAccount(selected);
}

async function removeAccount(accountId) {
  ensureAccountPoolLoaded();
  const account = getAccountById(accountId);
  if (!account) {
    throw new Error('账号不存在。');
  }

  if (runtime.loginSession) {
    await finalizeLoginSession({
      status: 'needs_login',
      message: '正在关闭登录浏览器...'
    });
  }

  if (browserDataDirExists(account.dataDir)) {
    fs.rmSync(account.dataDir, { recursive: true, force: true });
  }

  runtime.xhsAccounts = runtime.xhsAccounts.filter((item) => item.accountId !== account.accountId);
  execAccountStoreFileCommand('delete-xhs-account-file', { accountId: account.accountId });
  ensureAccountPoolLoaded();
  refreshLoginStateFromDisk();
  emitLog('warn', `已从账号池删除账号：${account.displayName}。`);
  return { ok: true, accountPool: getAccountPoolSnapshot() };
}

function syncLoginState(nextState) {
  const activeAccount = getActiveAccount();
  Object.assign(runtime.loginState, {
    activeAccount: activeAccount ? serializeAccount(activeAccount) : null,
    accountPool: getAccountPoolSnapshot(),
    ...nextState
  });
  emitToRenderer('xhs:login-state', { ...runtime.loginState });
}

function refreshLoginStateFromDisk() {
  ensureAccountPoolLoaded();
  const activeAccount = getActiveAccount();
  if (!activeAccount) {
    syncLoginState({
      status: 'needs_login',
      message: '账号池为空，请先新增小红书账号。',
      hasBrowserDataDir: false,
      isLoggedIn: false,
      isRunning: false,
      browserVisible: false
    });
    return;
  }

  const hasDir = browserDataDirExists(activeAccount.dataDir);
  syncLoginState({
    status: hasDir ? 'logged_in' : 'needs_login',
    message: hasDir
      ? `已检测到 ${activeAccount.dataDirName}，当前账号登录态可用。`
      : `未检测到 ${activeAccount.dataDirName}，请先完成当前账号登录。`,
    hasBrowserDataDir: hasDir,
    isLoggedIn: hasDir,
    isRunning: false,
    browserVisible: false
  });
}

function getPersistentContextLaunchOptions() {
  return {
    headless: false,
    viewport: { width: constants.LOGIN_WINDOW_WIDTH, height: constants.LOGIN_WINDOW_HEIGHT },
    screen: { width: constants.LOGIN_WINDOW_WIDTH, height: constants.LOGIN_WINDOW_HEIGHT },
    locale: 'zh-CN',
    args: [
      `--window-position=${getHiddenLoginWindowArg()}`,
      `--window-size=${constants.LOGIN_WINDOW_WIDTH},${constants.LOGIN_WINDOW_HEIGHT}`,
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process'
    ]
  };
}

function getVisibleLoginWindowBounds() {
  const workArea = screen.getPrimaryDisplay().workArea;
  return {
    left: Math.max(workArea.x, workArea.x + Math.floor((workArea.width - constants.LOGIN_WINDOW_WIDTH) / 2)),
    top: Math.max(workArea.y, workArea.y + Math.floor((workArea.height - constants.LOGIN_WINDOW_HEIGHT) / 2)),
    width: constants.LOGIN_WINDOW_WIDTH,
    height: constants.LOGIN_WINDOW_HEIGHT
  };
}

function getHiddenLoginWindowBounds() {
  const workArea = screen.getPrimaryDisplay().workArea;
  return {
    left: workArea.x + workArea.width + 120,
    top: workArea.y + 40,
    width: constants.LOGIN_WINDOW_WIDTH,
    height: constants.LOGIN_WINDOW_HEIGHT
  };
}

function getHiddenLoginWindowArg() {
  const bounds = getHiddenLoginWindowBounds();
  return `${bounds.left},${bounds.top}`;
}

async function isLoggedInOnPage(page) {
  try {
    return await page.evaluate(() => {
      const avatar = document.querySelector('.avatar, [class*="avatar"]');
      const loginBtn = document.querySelector('[class*="login"]');
      return avatar !== null && loginBtn === null;
    });
  } catch {
    return false;
  }
}

async function ensureLoginCdpSession(page) {
  if (runtime.loginSession?.cdp) {
    return runtime.loginSession.cdp;
  }

  const cdp = await page.context().newCDPSession(page);
  if (runtime.loginSession) {
    runtime.loginSession.cdp = cdp;
  }
  return cdp;
}

async function tryOpenLoginEntry(page) {
  const selectors = [
    'button:has-text("登录")',
    'button:has-text("注册")',
    'a:has-text("登录")',
    'a:has-text("注册")',
    'div:has-text("登录")',
    'span:has-text("登录")'
  ];

  for (const selector of selectors) {
    try {
      const locator = page.locator(selector).first();
      if (await locator.count()) {
        await locator.click({ timeout: 1500 });
        return true;
      }
    } catch {
      // Ignore and continue probing the next selector.
    }
  }

  return false;
}

function clampClipToViewport(clip, viewport) {
  const width = Math.min(Math.max(Math.round(clip.width), 120), viewport.width);
  const height = Math.min(Math.max(Math.round(clip.height), 120), viewport.height);
  const x = Math.min(Math.max(Math.round(clip.x), 0), Math.max(0, viewport.width - width));
  const y = Math.min(Math.max(Math.round(clip.y), 0), Math.max(0, viewport.height - height));
  return { x, y, width, height };
}

async function getLoginPreviewClip(page) {
  const viewport = page.viewportSize() || {
    width: constants.LOGIN_WINDOW_WIDTH,
    height: constants.LOGIN_WINDOW_HEIGHT
  };

  try {
    const qrCandidate = await page.evaluate(() => {
      function isVisible(element) {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.visibility !== 'hidden'
          && style.display !== 'none'
          && Number(style.opacity || 1) > 0
          && rect.width >= 96
          && rect.height >= 96
          && rect.width <= 430
          && rect.height <= 430
          && Math.abs(rect.width - rect.height) <= Math.max(rect.width, rect.height) * 0.35
          && rect.bottom > 0
          && rect.right > 0
          && rect.top < window.innerHeight
          && rect.left < window.innerWidth;
      }

      const candidates = Array.from(document.querySelectorAll('canvas, img, svg'))
        .filter(isVisible)
        .map((element) => {
          const rect = element.getBoundingClientRect();
          const area = rect.width * rect.height;
          const squareness = 1 - Math.min(Math.abs(rect.width - rect.height) / Math.max(rect.width, rect.height), 1);
          const centerBias = 1 - Math.min(Math.abs((rect.left + rect.width / 2) - window.innerWidth / 2) / (window.innerWidth / 2), 1);
          return {
            x: rect.left,
            y: rect.top,
            width: rect.width,
            height: rect.height,
            score: area * (0.7 + squareness) * (0.7 + centerBias)
          };
        })
        .sort((a, b) => b.score - a.score);

      return candidates[0] || null;
    });

    if (qrCandidate) {
      const qrCenterX = qrCandidate.x + qrCandidate.width / 2;
      const qrCenterY = qrCandidate.y + qrCandidate.height / 2;
      const clipWidth = Math.min(500, viewport.width);
      const clipHeight = Math.min(430, viewport.height);
      const horizontalOffset = 130;
      return clampClipToViewport({
        x: qrCenterX - clipWidth / 2 - horizontalOffset,
        y: qrCenterY - 180,
        width: clipWidth,
        height: clipHeight
      }, viewport);
    }
  } catch {
    // Fall back to the center login area below.
  }

  return clampClipToViewport({
    x: 0,
    y: Math.max(0, (viewport.height - 430) / 2),
    width: 520,
    height: Math.min(430, viewport.height)
  }, viewport);
}

function emitLoginPreview(buffer) {
  runtime.latestLoginScreenshot = `data:image/png;base64,${buffer.toString('base64')}`;
  if (runtime.loginSession) {
    runtime.loginSession.lastPreviewEmitAt = Date.now();
  }
  emitToRenderer('xhs:login-screenshot', {
    dataUrl: runtime.latestLoginScreenshot,
    capturedAt: new Date().toLocaleTimeString('zh-CN', { hour12: false })
  });
}

async function captureLoginPreview(scheduleNext = true) {
  if (!runtime.loginSession || runtime.loginSession.closing) {
    return;
  }

  const { page } = runtime.loginSession;
  if (!page || page.isClosed()) {
    await finalizeLoginSession({
      status: 'needs_login',
      message: '登录浏览器已关闭，尚未检测到登录完成。'
    });
    return;
  }

  try {
    const clip = await getLoginPreviewClip(page);
    const buffer = await page.screenshot({
      type: 'png',
      clip,
      fullPage: false,
      animations: 'disabled',
      caret: 'hide'
    });
    emitLoginPreview(buffer);
  } catch (error) {
    emitLog('warn', `登录截图更新失败：${error.message}`);
  } finally {
    if (scheduleNext && runtime.loginSession && !runtime.loginSession.closing) {
      if (runtime.loginSession.previewTimer) {
        clearTimeout(runtime.loginSession.previewTimer);
      }
      runtime.loginSession.previewTimer = setTimeout(() => {
        captureLoginPreview(true);
      }, constants.LOGIN_PREVIEW_INTERVAL_MS);
    }
  }
}

async function startLoginPreviewLoop() {
  if (!runtime.loginSession || runtime.loginSession.closing || runtime.loginSession.previewLoopActive) {
    return;
  }

  runtime.loginSession.previewLoopActive = true;
  if (runtime.loginSession.previewTimer) {
    clearTimeout(runtime.loginSession.previewTimer);
  }
  runtime.loginSession.previewTimer = setTimeout(() => {
    captureLoginPreview(true);
  }, constants.LOGIN_PREVIEW_INTERVAL_MS);
}

async function setLoginBrowserVisibility(visible) {
  if (!runtime.loginSession || runtime.loginSession.closing || !runtime.loginSession.page || runtime.loginSession.page.isClosed()) {
    return { ok: false };
  }

  try {
    const cdp = await ensureLoginCdpSession(runtime.loginSession.page);
    const { windowId } = await cdp.send('Browser.getWindowForTarget');
    const bounds = visible ? getVisibleLoginWindowBounds() : getHiddenLoginWindowBounds();

    await cdp.send('Browser.setWindowBounds', {
      windowId,
      bounds
    });

    if (visible) {
      await cdp.send('Page.bringToFront');
    }

    syncLoginState({
      browserVisible: visible,
      message: visible
        ? '登录浏览器已召回到可视范围。'
        : '登录浏览器已移到屏幕外，请在桌面预览中继续查看。'
    });
    await captureLoginPreview(false);
    return { ok: true };
  } catch (error) {
    emitLog('warn', `切换浏览器可见性失败：${error.message}`);
    return { ok: false, error: error.message };
  }
}

async function pollLoginCompletion() {
  if (!runtime.loginSession || runtime.loginSession.closing) {
    return;
  }

  const { page } = runtime.loginSession;
  if (!page || page.isClosed()) {
    await finalizeLoginSession({
      status: 'needs_login',
      message: '登录浏览器已关闭，尚未检测到登录完成。'
    });
    return;
  }

  try {
    const loggedIn = await isLoggedInOnPage(page);
    if (loggedIn) {
      emitLog('success', '检测到小红书登录完成，正在关闭登录浏览器。');
      await finalizeLoginSession({
        status: 'logged_in',
        message: '已完成小红书登录，浏览器数据已保存。',
        hasBrowserDataDir: true,
        isLoggedIn: true,
        isRunning: false
      });
      return;
    }
  } catch (error) {
    emitLog('warn', `登录状态检测失败：${error.message}`);
  } finally {
    if (runtime.loginSession && !runtime.loginSession.closing) {
      runtime.loginSession.loginPollTimer = setTimeout(pollLoginCompletion, 1800);
    }
  }
}

async function finalizeLoginSession(nextState) {
  if (!runtime.loginSession) {
    if (nextState) {
      const activeAccount = getActiveAccount();
      const hasDir = activeAccount ? browserDataDirExists(activeAccount.dataDir) : false;
      syncLoginState({
        hasBrowserDataDir: hasDir,
        isLoggedIn: hasDir,
        isRunning: false,
        browserVisible: false,
        ...nextState
      });
    }
    return;
  }

  const session = runtime.loginSession;
  session.closing = true;

  if (session.loginPollTimer) {
    clearTimeout(session.loginPollTimer);
  }
  if (session.previewTimer) {
    clearTimeout(session.previewTimer);
  }

  try {
    if (session.context) {
      await session.context.close();
    }
  } catch {
    // Ignore close errors.
  }

  runtime.loginSession = null;
  runtime.latestLoginScreenshot = null;
  emitToRenderer('xhs:login-screenshot', { dataUrl: null, capturedAt: null });

  const activeAccount = getActiveAccount();
  const hasDir = activeAccount ? browserDataDirExists(activeAccount.dataDir) : false;
  syncLoginState({
    hasBrowserDataDir: hasDir,
    isLoggedIn: hasDir,
    isRunning: false,
    browserVisible: false,
    ...nextState
  });
}

async function deleteXhsBrowserData(accountId = runtime.activeXhsAccountId) {
  try {
    const account = getAccountById(accountId) || getActiveAccount();
    if (!account) {
      return { ok: false, error: '账号池为空，请先新增账号。' };
    }
    if (runtime.loginSession) {
      await finalizeLoginSession({
        status: 'needs_login',
        message: '正在清理本地登录数据...'
      });
    }

    if (browserDataDirExists(account.dataDir)) {
      fs.rmSync(account.dataDir, { recursive: true, force: true });
    }

    runtime.latestLoginScreenshot = null;
    emitToRenderer('xhs:login-screenshot', { dataUrl: null, capturedAt: null });
    syncLoginState({
      status: 'needs_login',
      message: `已清理 ${account.dataDirName}，请重新登录。`,
      hasBrowserDataDir: false,
      isLoggedIn: false,
      isRunning: false,
      browserVisible: false
    });
    emitLog('warn', `已删除本地账号数据：${account.dataDirName}。`);
    return { ok: true };
  } catch (error) {
    emitLog('warn', `删除本地登录数据失败：${error.message}`);
    return { ok: false, error: error.message };
  }
}

async function startLoginFlow(payload = {}) {
  if (runtime.loginSession) {
    emitLog('info', '登录浏览器已经在运行。');
    return { ok: true };
  }

  let activeAccount = getActiveAccount();
  if (payload.username) {
    createAccount({ username: payload.username });
    activeAccount = getActiveAccount();
  } else if (payload.accountId) {
    const selected = getAccountById(payload.accountId);
    if (selected) {
      execAccountStoreFileCommand('set-active-xhs-account-file', { accountId: selected.accountId });
      ensureAccountPoolLoaded();
      activeAccount = selected;
    }
  }

  if (!activeAccount) {
    syncLoginState({
      status: 'needs_login',
      message: '账号池为空，请先新增账号再登录。',
      hasBrowserDataDir: false,
      isLoggedIn: false,
      isRunning: false,
      browserVisible: false
    });
    return { ok: false, error: '账号池为空，请先新增账号。' };
  }

  const hasDir = browserDataDirExists(activeAccount.dataDir);
  syncLoginState({
    status: 'login_running',
    message: `正在打开小红书登录浏览器：${activeAccount.displayName}...`,
    hasBrowserDataDir: hasDir,
    isLoggedIn: false,
    isRunning: true,
    browserVisible: false
  });
  emitLog('info', `准备启动 Playwright 登录浏览器：${activeAccount.dataDirName}。`);

  try {
    const context = await chromium.launchPersistentContext(
      activeAccount.dataDir,
      getPersistentContextLaunchOptions()
    );

    const page = context.pages()[0] || await context.newPage();
    runtime.loginSession = {
      context,
      page,
      loginPollTimer: null,
      previewTimer: null,
      cdp: null,
      lastPreviewEmitAt: 0,
      previewLoopActive: false,
      closing: false
    };

    await ensureLoginCdpSession(page);
    await setLoginBrowserVisibility(false);
    await page.goto(constants.XHS_HOME_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
    await page.setViewportSize({ width: constants.LOGIN_WINDOW_WIDTH, height: constants.LOGIN_WINDOW_HEIGHT });

    if (await isLoggedInOnPage(page)) {
      emitLog('success', '检测到当前浏览器数据已经处于登录状态。');
      await finalizeLoginSession({
        status: 'logged_in',
        message: `检测到 ${activeAccount.displayName} 已有有效登录态，无需重复登录。`,
        hasBrowserDataDir: true,
        isLoggedIn: true,
        isRunning: false
      });
      return { ok: true };
    }

    const loginEntryOpened = await tryOpenLoginEntry(page);
    if (!loginEntryOpened) {
      emitLog('info', '未自动命中登录入口，请在浏览器中手动点击登录。');
    }
    emitLog('info', '登录浏览器已打开，请在浏览器窗口完成小红书登录。');

    await captureLoginPreview(false);
    await startLoginPreviewLoop();
    await pollLoginCompletion();
    return { ok: true };
  } catch (error) {
    await finalizeLoginSession({
      status: 'error',
      message: `登录浏览器启动失败：${error.message}`,
      hasBrowserDataDir: browserDataDirExists(activeAccount.dataDir),
      isLoggedIn: false,
      isRunning: false
    });
    emitLog('warn', `登录流程启动失败：${error.message}`);
    return { ok: false, error: error.message };
  }
}

function getLoginSnapshot() {
  refreshLoginStateFromDisk();
  return {
    ...runtime.loginState,
    screenshot: runtime.latestLoginScreenshot
  };
}

async function finalizeBeforeQuit() {
  if (!runtime.loginSession) {
    return;
  }

  const activeAccount = getActiveAccount();
  const hasDir = activeAccount ? browserDataDirExists(activeAccount.dataDir) : false;
  await finalizeLoginSession({
    status: hasDir ? 'logged_in' : 'needs_login',
    message: hasDir
      ? '应用关闭前已保存本地登录态。'
      : '应用关闭，未检测到有效登录态。'
  });
}

module.exports = {
  refreshLoginStateFromDisk,
  startLoginFlow,
  setLoginBrowserVisibility,
  deleteXhsBrowserData,
  getAccountPoolSnapshot,
  getActiveAccount,
  createAccount,
  setActiveAccount,
  removeAccount,
  getLoginSnapshot,
  finalizeBeforeQuit
};
