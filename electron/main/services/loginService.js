const fs = require('node:fs');

const { screen } = require('electron');
const { chromium } = require('playwright');

const constants = require('../config/constants');
const runtime = require('../state/runtime');
const { emitLog, emitToRenderer } = require('./emitterService');
const { browserDataDirExists } = require('./storageService');

function syncLoginState(nextState) {
  Object.assign(runtime.loginState, nextState);
  emitToRenderer('xhs:login-state', { ...runtime.loginState });
}

function refreshLoginStateFromDisk() {
  const hasDir = browserDataDirExists();
  syncLoginState({
    status: hasDir ? 'logged_in' : 'needs_login',
    message: hasDir
      ? '已检测到 xhs_browser_data，本地登录态可用。'
      : '未检测到 xhs_browser_data，请先完成小红书登录。',
    hasBrowserDataDir: hasDir,
    isLoggedIn: hasDir,
    isRunning: false,
    browserVisible: false
  });
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

function emitLoginPreview(buffer) {
  runtime.latestLoginScreenshot = `data:image/jpeg;base64,${buffer.toString('base64')}`;
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
    const buffer = await page.screenshot({
      type: 'jpeg',
      quality: 72,
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
      syncLoginState({
        hasBrowserDataDir: browserDataDirExists(),
        isLoggedIn: browserDataDirExists(),
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

  syncLoginState({
    hasBrowserDataDir: browserDataDirExists(),
    isLoggedIn: browserDataDirExists(),
    isRunning: false,
    browserVisible: false,
    ...nextState
  });
}

async function deleteXhsBrowserData() {
  try {
    if (runtime.loginSession) {
      await finalizeLoginSession({
        status: 'needs_login',
        message: '正在清理本地登录数据...'
      });
    }

    if (browserDataDirExists()) {
      fs.rmSync(constants.XHS_BROWSER_DATA_DIR, { recursive: true, force: true });
    }

    runtime.latestLoginScreenshot = null;
    emitToRenderer('xhs:login-screenshot', { dataUrl: null, capturedAt: null });
    syncLoginState({
      status: 'needs_login',
      message: '已清理本地小红书登录数据，请重新登录。',
      hasBrowserDataDir: false,
      isLoggedIn: false,
      isRunning: false,
      browserVisible: false
    });
    emitLog('warn', '已删除本地 xhs_browser_data。');
    return { ok: true };
  } catch (error) {
    emitLog('warn', `删除本地登录数据失败：${error.message}`);
    return { ok: false, error: error.message };
  }
}

async function startLoginFlow() {
  if (runtime.loginSession) {
    emitLog('info', '登录浏览器已经在运行。');
    return { ok: true };
  }

  syncLoginState({
    status: 'login_running',
    message: '正在打开小红书登录浏览器...',
    hasBrowserDataDir: browserDataDirExists(),
    isLoggedIn: false,
    isRunning: true,
    browserVisible: false
  });
  emitLog('info', '准备启动 Playwright 登录浏览器。');

  try {
    const context = await chromium.launchPersistentContext(constants.XHS_BROWSER_DATA_DIR, {
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
    });

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
        message: '检测到已有有效登录态，无需重复登录。',
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
      hasBrowserDataDir: browserDataDirExists(),
      isLoggedIn: false,
      isRunning: false
    });
    emitLog('warn', `登录流程启动失败：${error.message}`);
    return { ok: false, error: error.message };
  }
}

function getLoginSnapshot() {
  return {
    ...runtime.loginState,
    screenshot: runtime.latestLoginScreenshot
  };
}

async function finalizeBeforeQuit() {
  if (!runtime.loginSession) {
    return;
  }

  await finalizeLoginSession({
    status: browserDataDirExists() ? 'logged_in' : 'needs_login',
    message: browserDataDirExists()
      ? '应用关闭前已保存本地登录态。'
      : '应用关闭，未检测到有效登录态。'
  });
}

module.exports = {
  refreshLoginStateFromDisk,
  startLoginFlow,
  setLoginBrowserVisibility,
  deleteXhsBrowserData,
  getLoginSnapshot,
  finalizeBeforeQuit
};
