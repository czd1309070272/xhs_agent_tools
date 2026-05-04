import { clearAppError, formatErrorDetail, showAppError } from './diagnostics.js';
import { elements } from './elements.js';
import { createLogService } from './logService.js';
import { createLoginController } from './loginController.js';
import { createModalController } from './modalController.js';
import { createResultsController } from './resultsController.js';
import { state } from './state.js';
import { createTaskHistoryController } from './taskHistoryController.js';

const desktopApi = window.desktopApi;

function updateRunAvailability() {
  elements.runButton.disabled = state.isRunning || !state.loginState.isLoggedIn || !state.aiConfig.isConfigured;
  elements.stopButton.disabled = !state.isRunning;
  elements.clearResultsButton.disabled = state.previewResults.length === 0;
}

function updateRunStatus(nextText, nextHint = '') {
  state.runStatusText = nextText || (state.isRunning ? '任务执行中' : '待机中');
  state.runStatusHint = nextHint || (state.isRunning ? '搜索进行中。' : '等待任务启动。');
  elements.runStatus.textContent = state.runStatusText;
  elements.runStatusHint.textContent = state.runStatusHint;

  state.liveStatusText = state.runStatusText;
  state.liveStatusHint = state.runStatusHint;
  state.liveStatusTimestamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  elements.liveStatusText.textContent = state.liveStatusText;
  elements.liveStatusHint.textContent = state.liveStatusHint;
  elements.liveStatusTime.textContent = state.liveStatusTimestamp;
  elements.liveStatusShell.dataset.thinking = state.isAiThinking ? 'true' : 'false';
  elements.liveThinkingDots.hidden = !state.isAiThinking;
}

function setRunningState(nextState) {
  state.isRunning = nextState;
  state.isAiThinking = false;
  updateRunStatus(nextState ? '任务执行中' : '待机中', nextState ? '搜索进行中。' : '等待任务启动。');
  updateRunAvailability();
}

function updateAiSettingsFormState() {
  const disabled = state.isSavingAiConfig;
  elements.aiBaseUrlInput.disabled = disabled;
  elements.aiApiKeyInput.disabled = disabled;
  elements.aiModelInput.disabled = disabled;
  elements.saveAiSettingsButton.disabled = disabled;
  elements.cancelAiSettingsButton.disabled = disabled;
  elements.closeSettingsButton.disabled = disabled;
}

function getAiConfigSourceText(source) {
  if (source === 'saved') {
    return '本地设置';
  }
  if (source === 'env') {
    return '.env / 环境变量';
  }
  return '默认值';
}

function updateAiConfigUI(nextConfig = {}) {
  state.aiConfig = {
    ...state.aiConfig,
    ...nextConfig,
    apiKey: typeof nextConfig.apiKey === 'string' ? nextConfig.apiKey : state.aiConfig.apiKey,
    baseUrl: typeof nextConfig.baseUrl === 'string' ? nextConfig.baseUrl : state.aiConfig.baseUrl,
    model: typeof nextConfig.model === 'string' ? nextConfig.model : state.aiConfig.model,
    source: typeof nextConfig.source === 'string' ? nextConfig.source : state.aiConfig.source,
    isConfigured: Boolean(nextConfig.isConfigured ?? state.aiConfig.isConfigured)
  };

  if (state.aiConfig.isConfigured) {
    elements.aiConfigSummary.textContent = `${state.aiConfig.model} · ${state.aiConfig.baseUrl}`;
    elements.aiConfigHint.textContent = `当前配置来源：${getAiConfigSourceText(state.aiConfig.source)}。搜索按钮会把这组 OpenAI 兼容参数传给 Python worker。`;
    elements.aiSettingsMeta.textContent = `当前生效：${state.aiConfig.model} @ ${state.aiConfig.baseUrl}`;
  } else {
    elements.aiConfigSummary.textContent = 'AI 未配置';
    elements.aiConfigHint.textContent = '请先在“AI 设置”中填写 Base URL、API Key 和模型名称，然后再启动搜索。';
    elements.aiSettingsMeta.textContent = '当前尚未配置可用的 AI 接口。';
  }

  updateRunAvailability();
}

function syncAiSettingsForm() {
  elements.aiBaseUrlInput.value = state.aiConfig.baseUrl || '';
  elements.aiApiKeyInput.value = state.aiConfig.apiKey || '';
  elements.aiModelInput.value = state.aiConfig.model || '';
  updateAiSettingsFormState();
}

function setAiSettingsOpen(nextState) {
  state.isAiSettingsOpen = nextState;
  elements.settingsModal.hidden = !nextState;
  if (nextState) {
    syncAiSettingsForm();
  }
}

const { appendLog, appendInternalLog, renderInternalLogs } = createLogService(elements);
const taskHistoryController = createTaskHistoryController({ elements, state });
const modalController = createModalController({ elements, state, desktopApi });
const loginController = createLoginController({
  elements,
  state,
  desktopApi,
  appendLog,
  updateRunAvailability
});
const resultsController = createResultsController({
  elements,
  state,
  desktopApi,
  appendLog,
  modalController,
  taskHistoryController,
  updateRunAvailability
});

async function bootstrap() {
  if (!desktopApi) {
    throw new Error('window.desktopApi 未注入。preload 可能没有成功加载，所有按钮都会失效。');
  }

  const initialState = await desktopApi.getInitialState();
  state.taskHistoryEntries = Array.isArray(initialState.taskHistory) ? initialState.taskHistory : [];
  state.internalLogs = Array.isArray(initialState.internalLogs) ? initialState.internalLogs : [];
  resultsController.hydrateInitialState(initialState);
  taskHistoryController.renderTaskHistory();
  renderInternalLogs(state.internalLogs);
  loginController.updateLoginUI(initialState.xhsLogin || {});
  updateAiConfigUI(initialState.aiConfig || {});
  loginController.updateLoginScreenshot({
    dataUrl: initialState.xhsLogin?.screenshot || null,
    capturedAt: null
  });
  setRunningState(false);
  loginController.ensurePreviewCountdownTimer();

  appendLog({
    level: 'info',
    timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
    message: '桌面 UI 已加载，先完成小红书登录，再执行真实搜索。'
  });
  elements.logMeta.textContent = '详细过程保留最近 1 条';
  clearAppError(elements);
}

function bindAppEvents() {
  if (!desktopApi) {
    return;
  }

  taskHistoryController.bindEvents();
  modalController.bindEvents();
  loginController.bindEvents();
  resultsController.bindEvents();

  elements.aiSettingsButton.addEventListener('click', () => {
    setAiSettingsOpen(true);
  });
  elements.closeSettingsButton.addEventListener('click', () => {
    setAiSettingsOpen(false);
  });
  elements.cancelAiSettingsButton.addEventListener('click', () => {
    setAiSettingsOpen(false);
  });
  elements.settingsBackdrop.addEventListener('click', () => {
    setAiSettingsOpen(false);
  });
  elements.aiSettingsForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    state.isSavingAiConfig = true;
    updateAiSettingsFormState();

    const payload = {
      baseUrl: elements.aiBaseUrlInput.value.trim(),
      apiKey: elements.aiApiKeyInput.value.trim(),
      model: elements.aiModelInput.value.trim()
    };

    try {
      const result = await desktopApi.saveAiConfig(payload);
      if (!result?.ok) {
        elements.aiSettingsMeta.textContent = result?.error || 'AI 配置保存失败。';
        return;
      }

      updateAiConfigUI(result.config || {});
      elements.aiSettingsMeta.textContent = 'AI 配置已保存，新任务会使用最新参数。';
      setAiSettingsOpen(false);
      appendLog({
        level: 'success',
        timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
        message: `AI 配置已更新：${result.config?.model || payload.model}`
      });
    } finally {
      state.isSavingAiConfig = false;
      updateAiSettingsFormState();
    }
  });

  elements.runButton.addEventListener('click', async () => {
    const query = elements.queryInput.value.trim();
    if (!query) {
      appendLog({
        level: 'warn',
        timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
        message: '缺少搜索需求。'
      });
      return;
    }
    if (!state.aiConfig.isConfigured) {
      appendLog({
        level: 'warn',
        timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
        message: 'AI 配置不完整，请先填写 Base URL、API Key 和模型。'
      });
      setAiSettingsOpen(true);
      return;
    }

    const payload = {
      query
    };

    setRunningState(true);
    updateRunStatus('任务初始化中', '已提交任务，等待桌面主进程响应。');
    appendLog({
      level: 'info',
      timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
      message: '已提交任务，等待桌面主进程响应。'
    });
    await desktopApi.startRun(payload);
  });

  elements.stopButton.addEventListener('click', async () => {
    await desktopApi.cancelRun();
  });

  elements.docButton.addEventListener('click', () => {
    desktopApi.openExternal('https://www.xiaohongshu.com');
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.isAiSettingsOpen) {
      setAiSettingsOpen(false);
      return;
    }
    if (event.key === 'Escape' && !elements.imageZoomModal.hidden) {
      modalController.closeImageZoom();
      return;
    }
    if (event.key === 'Escape' && state.isTaskHistoryOpen) {
      taskHistoryController.setTaskHistoryOpen(false);
      return;
    }
    if (event.key === 'Escape' && !elements.libraryPage.hidden) {
      resultsController.closeLibraryPage();
      return;
    }
    if (event.key === 'Escape' && !elements.resultModal.hidden) {
      modalController.closeResultModal();
    }
  });

  desktopApi.onXhsLoginState((payload) => {
    loginController.updateLoginUI(payload);
  });
  desktopApi.onXhsLoginScreenshot((payload) => {
    loginController.updateLoginScreenshot(payload);
  });
  desktopApi.onLog((entry) => {
    appendLog(entry);
    if (!state.isAiThinking) {
      state.liveStatusText = entry.message || state.liveStatusText;
      state.liveStatusTimestamp = entry.timestamp || new Date().toLocaleTimeString('zh-CN', { hour12: false });
      elements.liveStatusText.textContent = state.liveStatusText;
      elements.liveStatusTime.textContent = state.liveStatusTimestamp;
    }
  });
  desktopApi.onAgentStatus((payload) => {
    state.isAiThinking = Boolean(payload?.thinking);
    updateRunStatus(
      payload?.text || (state.isRunning ? '任务执行中' : '待机中'),
      payload?.detail || (state.isRunning ? '搜索进行中。' : '等待任务启动。')
    );
  });
  desktopApi.onInternalLog((entry) => {
    state.internalLogs = [entry, ...state.internalLogs].slice(0, 200);
    appendInternalLog(entry);
    elements.internalLogEmptyState.hidden = true;
    elements.internalLogMeta.textContent = `当前记录 ${state.internalLogs.length} 条内部诊断`;
  });
  desktopApi.onCompleted((payload) => {
    setRunningState(false);
    resultsController.handleCompleted(payload);
    if (payload.historyEntry) {
      taskHistoryController.prependHistoryEntry(payload.historyEntry);
    }
    appendLog({
      level: payload.cancelled ? 'warn' : (payload.failed ? 'warn' : 'success'),
      timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
      message: payload.summary
    });
  });
}

window.addEventListener('error', (event) => {
  showAppError(elements, 'Renderer Error', event.error || event.message || '未知渲染错误');
});

window.addEventListener('unhandledrejection', (event) => {
  showAppError(elements, 'Unhandled Rejection', event.reason);
});

try {
  bindAppEvents();
  bootstrap().catch((error) => {
    showAppError(elements, 'Bootstrap Failed', error);
  });
} catch (error) {
  showAppError(elements, 'App Init Failed', error);
  throw error;
}
