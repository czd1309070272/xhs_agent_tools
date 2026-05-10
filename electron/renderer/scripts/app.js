import { clearAppError, formatErrorDetail, showAppError } from './diagnostics.js';
import { elements } from './elements.js';
import { createLogService } from './logService.js';
import { createLoginController } from './loginController.js';
import { createModalController } from './modalController.js';
import { createResultsController } from './resultsController.js';
import { createReportController } from './reportController.js';
import { state } from './state.js';
import { createTaskHistoryController } from './taskHistoryController.js';

const desktopApi = window.desktopApi;

function getTaskModeConfig() {
  if (state.taskMode === 'daily_task') {
    return {
      label: '每日任务',
      meta: '当前模式：每日任务，保存后先展示任务草稿效果，后续再接数据库和定时调度。',
      queryLabel: '每日任务需求',
      queryPlaceholder: '例如：每天帮我找 3 篇比较新的 AI Agent 产品动态，优先看功能更新和实测反馈。',
      runButtonText: '保存每日任务',
      runStatusHint: '当前为每日任务模式，保存后不会立刻启动搜索。'
    };
  }

  return {
    label: '立即执行',
    meta: '当前模式：立即执行，提交后立刻启动真实搜索。',
    queryLabel: '搜索需求',
    queryPlaceholder: '例如：帮我找几篇比较新的 Claude Code 使用技巧，最好有实测流程和踩坑总结。',
    runButtonText: '启动搜索',
    runStatusHint: '等待任务启动。'
  };
}

function updateRunAvailability() {
  const isRunNowMode = state.taskMode === 'run_now';
  const hasActiveAccount = Boolean(state.accountPool.activeAccountId);
  elements.runButton.disabled = state.isRunning
    || !state.aiConfig.isConfigured
    || !hasActiveAccount
    || (isRunNowMode && !state.loginState.isLoggedIn);
  elements.stopButton.hidden = !isRunNowMode;
  elements.stopButton.disabled = !isRunNowMode || !state.isRunning;
  elements.runNowModeButton.disabled = state.isRunning;
  elements.dailyTaskModeButton.disabled = state.isRunning;
  elements.taskAccountSelect.disabled = state.isRunning || state.accountPool.accounts.length === 0;
  elements.clearResultsButton.disabled = state.previewResults.length === 0;
  updateHomeDashboard();
}

function renderTaskAccountSelect() {
  const accounts = Array.isArray(state.accountPool.accounts) ? state.accountPool.accounts : [];
  const activeAccountId = state.accountPool.activeAccountId || '';
  elements.taskAccountSelect.replaceChildren();

  if (accounts.length === 0) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = '请先新增账号';
    elements.taskAccountSelect.appendChild(option);
    elements.taskAccountSelect.value = '';
    elements.taskAccountHint.textContent = '账号池为空，请先在账号管理中新增小红书账号。';
    return;
  }

  accounts.forEach((account) => {
    const option = document.createElement('option');
    option.value = account.accountId;
    const status = account.hasBrowserDataDir ? '已登录' : '未登录';
    option.textContent = `${account.displayName || account.username} · ${status}`;
    elements.taskAccountSelect.appendChild(option);
  });

  elements.taskAccountSelect.value = activeAccountId || accounts[0]?.accountId || '';
  const selected = accounts.find((account) => account.accountId === elements.taskAccountSelect.value);
  elements.taskAccountHint.textContent = selected
    ? `当前使用 ${selected.dataDirName}${selected.hasBrowserDataDir ? '' : '，该账号尚未登录'}。`
    : '请选择执行账号。';
}

function buildDailyTaskTitle() {
  const customName = (state.dailyTaskDraft.name || '').trim();
  if (customName) {
    return customName;
  }

  const query = elements.queryInput.value.trim();
  if (!query) {
    return '每日任务草稿';
  }

  return query.length > 20 ? `${query.slice(0, 20)}...` : query;
}

function formatNextRunLabel(nextRunAt, fallbackTime = '09:30') {
  if (!nextRunAt) {
    return `执行时间 ${fallbackTime}`;
  }

  const parsed = new Date(nextRunAt);
  if (Number.isNaN(parsed.getTime())) {
    return `执行时间 ${fallbackTime}`;
  }

  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  const hours = String(parsed.getHours()).padStart(2, '0');
  const minutes = String(parsed.getMinutes()).padStart(2, '0');
  return `下次执行 ${month}-${day} ${hours}:${minutes}`;
}

function truncateText(text, maxLength = 72) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '';
  }
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

function getLoginStatusText(status) {
  const statusTextMap = {
    checking: '检查中',
    needs_login: '未登录',
    login_running: '登录中',
    logged_in: '已登录',
    error: '异常'
  };
  return statusTextMap[status] || '未知状态';
}

function updateHomeDashboard() {
  const modeConfig = getTaskModeConfig();
  const libraryCount = Array.isArray(state.fullLibraryResults)
    ? state.fullLibraryResults.length
    : state.libraryResults.length;
  const nextRunText = state.dailyTaskDraft.nextRunAt
    ? formatNextRunLabel(state.dailyTaskDraft.nextRunAt, state.dailyTaskDraft.time)
    : `每日任务 ${state.dailyTaskDraft.enabled ? '启用' : '暂停'} · ${state.dailyTaskDraft.time || '09:30'}`;

  elements.homeRunStatus.textContent = state.runStatusText || (state.isRunning ? '任务执行中' : '待机中');
  elements.homeTaskModeMeta.textContent = `当前模式：${modeConfig.label}`;
  elements.homeTaskStatus.textContent = state.isRunning ? '执行中' : '待机中';
  elements.homeTaskSummary.textContent = state.taskMode === 'daily_task'
    ? `${nextRunText}。进入任务执行页可调整需求、时间和启用状态。`
    : '进入当前任务执行界面，配置立即搜索或切换到每日任务。';

  elements.homeLoginStatus.textContent = getLoginStatusText(state.loginState.status);
  elements.homeLoginMessage.textContent = state.loginState.message || '等待进一步操作。';
  elements.homeLoginButton.disabled = Boolean(state.loginState.isRunning);
  elements.homeLoginButton.textContent = '账号管理';

  elements.homeAiStatus.textContent = state.aiConfig.isConfigured ? '已配置' : '未配置';
  elements.homeAiSummary.textContent = state.aiConfig.isConfigured
    ? `${state.aiConfig.model || '未命名模型'} · ${state.aiConfig.baseUrl || '未填写 Base URL'}`
    : '请先配置 Base URL、API Key 和模型名称，搜索和报告都依赖这组参数。';

  elements.homeReportStatus.textContent = '报告';
  elements.homeReportSummary.textContent = '查看每日任务生成的 LLM 分析报告，支持报告详情与相关帖子跳转。';
  elements.homeCompetitorStatus.textContent = state.dailyTaskDraft.enabled && state.dailyTaskDraft.name.includes('竞品')
    ? '已启用'
    : '监控';
  elements.homeCompetitorSummary.textContent = '从竞品关键词出发，复用每日任务与报告链路，持续跟踪新品、活动、用户反馈和达人投放线索。';
  elements.homeLibraryStatus.textContent = `${libraryCount} 条`;
  elements.homeLibrarySummary.textContent = `当前收录 ${libraryCount} 条帖子，可进入仓库统一检索、排序和管理。`;
}

function showHomePage() {
  elements.homePage.hidden = false;
  elements.mainPage.hidden = true;
  elements.competitorPage.hidden = true;
  elements.libraryPage.hidden = true;
  elements.reportPage.hidden = true;
  elements.taskHistoryShell.classList.add('is-hidden');
  updateHomeDashboard();
  if (elements.appShell) {
    elements.appShell.scrollTop = 0;
  }
}

function showTaskPage() {
  elements.homePage.hidden = true;
  elements.mainPage.hidden = false;
  elements.competitorPage.hidden = true;
  elements.libraryPage.hidden = true;
  elements.reportPage.hidden = true;
  elements.taskHistoryShell.classList.remove('is-hidden');
  if (elements.appShell) {
    elements.appShell.scrollTop = 0;
  }
}

function buildDailyTaskHint(queryPreview, time, enabled) {
  if (!enabled) {
    return `这条任务目前处于暂停草稿状态：${queryPreview}`;
  }

  const status = state.dailyTaskDraft.lastRunStatus || '';
  const summary = truncateText(state.dailyTaskDraft.lastRunSummary, 68);

  if (status === 'failed') {
    return `上次执行失败，请查看右侧日志。当前需求：${queryPreview}`;
  }

  if (status === 'cancelled') {
    return `上次执行已取消。当前需求：${queryPreview}`;
  }

  if (status === 'completed' && summary) {
    return `${summary} 当前需求：${queryPreview}`;
  }

  return `计划在每天 ${time} 自动执行这条需求：${queryPreview}`;
}

function hydrateDailyTaskDraft(task = null) {
  if (!task) {
    state.dailyTaskDraft = {
      ...state.dailyTaskDraft,
      taskId: '',
      name: '',
      time: '09:30',
      enabled: true,
      nextRunAt: '',
      lastRunSummary: '',
      lastRunStatus: '',
    };
    return;
  }

  state.dailyTaskDraft = {
    ...state.dailyTaskDraft,
    taskId: task.taskId || '',
    name: task.name || '',
    time: task.scheduleTime || '09:30',
    enabled: Boolean(task.enabled),
    nextRunAt: task.nextRunAt || '',
    lastRunSummary: task.lastRunSummary || '',
    lastRunStatus: task.lastRunStatus || '',
  };
  elements.queryInput.value = task.query || elements.queryInput.value;
}

function updateDailyTaskDraftCard() {
  const query = elements.queryInput.value.trim();
  const time = state.dailyTaskDraft.time || '09:30';
  const enabled = Boolean(state.dailyTaskDraft.enabled);
  const taskTitle = buildDailyTaskTitle();
  const queryPreview = query ? (query.length > 46 ? `${query.slice(0, 46)}...` : query) : '这里会预览将要每天执行的搜索需求。';

  elements.taskDraftTitle.textContent = taskTitle;
  elements.taskDraftBadge.textContent = enabled ? '每日执行' : '已暂停';
  elements.taskDraftTime.textContent = formatNextRunLabel(state.dailyTaskDraft.nextRunAt, time);
  elements.taskDraftState.textContent = `状态：${enabled ? '启用' : '暂停'}`;
  elements.taskDraftHint.textContent = buildDailyTaskHint(queryPreview, time, enabled);
}

function updateTaskModeUI() {
  const config = getTaskModeConfig();
  const isDailyTaskMode = state.taskMode === 'daily_task';

  elements.runNowModeButton.classList.toggle('is-active', !isDailyTaskMode);
  elements.dailyTaskModeButton.classList.toggle('is-active', isDailyTaskMode);
  elements.inputPanel.classList.toggle('is-daily-task', isDailyTaskMode);
  elements.runNowModeButton.setAttribute('aria-selected', String(!isDailyTaskMode));
  elements.dailyTaskModeButton.setAttribute('aria-selected', String(isDailyTaskMode));
  elements.taskModeMeta.textContent = config.meta;
  elements.queryFieldLabel.textContent = config.queryLabel;
  elements.queryInput.placeholder = config.queryPlaceholder;
  elements.dailyTaskFields.hidden = !isDailyTaskMode;
  elements.runButton.textContent = config.runButtonText;

  if (!state.isRunning) {
    updateRunStatus('待机中', config.runStatusHint);
  }

  updateDailyTaskDraftCard();
  updateAiConfigUI(state.aiConfig);
  updateRunAvailability();
  updateHomeDashboard();
}

function setTaskMode(nextMode) {
  if (nextMode !== 'run_now' && nextMode !== 'daily_task') {
    return;
  }

  state.taskMode = nextMode;
  updateTaskModeUI();
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
  updateHomeDashboard();
}

function setRunningState(nextState) {
  state.isRunning = nextState;
  state.isAiThinking = false;
  updateRunStatus(nextState ? '任务执行中' : '待机中', nextState ? '搜索进行中。' : '等待任务启动。');
  updateRunAvailability();
  updateHomeDashboard();
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
    elements.aiConfigHint.textContent = state.taskMode === 'daily_task'
      ? `当前配置来源：${getAiConfigSourceText(state.aiConfig.source)}。保存每日任务后，后续定时执行会沿用这组 OpenAI 兼容参数。`
      : `当前配置来源：${getAiConfigSourceText(state.aiConfig.source)}。搜索按钮会把这组 OpenAI 兼容参数传给 Python worker。`;
    elements.aiSettingsMeta.textContent = `当前生效：${state.aiConfig.model} @ ${state.aiConfig.baseUrl}`;
  } else {
    elements.aiConfigSummary.textContent = 'AI 未配置';
    elements.aiConfigHint.textContent = state.taskMode === 'daily_task'
      ? '请先在“AI 设置”中填写 Base URL、API Key 和模型名称；后续每日任务会复用这组配置。'
      : '请先在“AI 设置”中填写 Base URL、API Key 和模型名称，然后再启动搜索。';
    elements.aiSettingsMeta.textContent = '当前尚未配置可用的 AI 接口。';
  }

  renderTaskAccountSelect();
  updateRunAvailability();
  updateHomeDashboard();
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

function setLoginModalOpen(nextState) {
  state.isLoginModalOpen = nextState;
  elements.loginModal.hidden = !nextState;
}

function showCompetitorPage() {
  elements.homePage.hidden = true;
  elements.mainPage.hidden = true;
  elements.competitorPage.hidden = false;
  elements.libraryPage.hidden = true;
  elements.reportPage.hidden = true;
  elements.taskHistoryShell.classList.add('is-hidden');
  if (elements.appShell) {
    elements.appShell.scrollTop = 0;
  }
}

const { appendLog, appendInternalLog, renderInternalLogs } = createLogService(elements);
const taskHistoryController = createTaskHistoryController({ elements, state });
const modalController = createModalController({ elements, state, desktopApi });
const reportController = createReportController();
const loginController = createLoginController({
  elements,
  state,
  desktopApi,
  appendLog,
  updateRunAvailability,
  onAccountPoolChanged: () => {
    renderTaskAccountSelect();
    updateRunAvailability();
    updateHomeDashboard();
  }
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
  renderTaskAccountSelect();
  updateAiConfigUI(initialState.aiConfig || {});
  hydrateDailyTaskDraft(initialState.activeDailyTask || null);
  loginController.updateLoginScreenshot({
    dataUrl: initialState.xhsLogin?.screenshot || null,
    capturedAt: null
  });
  elements.taskNameInput.value = state.dailyTaskDraft.name;
  elements.dailyTimeInput.value = state.dailyTaskDraft.time;
  elements.taskEnabledInput.checked = state.dailyTaskDraft.enabled;
  setRunningState(false);
  updateTaskModeUI();
  loginController.ensurePreviewCountdownTimer();

  appendLog({
    level: 'info',
    timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
    message: '桌面 UI 已加载，先完成小红书登录，再执行真实搜索。'
  });
  elements.logMeta.textContent = '详细过程保留最近 1 条';
  showHomePage();
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
  reportController.bindEvents();

  elements.aiSettingsButton.addEventListener('click', () => {
    setAiSettingsOpen(true);
  });
  elements.openTaskPageButton.addEventListener('click', () => {
    showTaskPage();
  });
  elements.openCompetitorMonitorButton.addEventListener('click', () => {
    showCompetitorPage();
  });
  elements.closeCompetitorButton.addEventListener('click', () => {
    showHomePage();
  });
  elements.backHomeFromTaskButton.addEventListener('click', () => {
    showHomePage();
  });
  elements.homeLoginButton.addEventListener('click', () => {
    setLoginModalOpen(true);
  });
  elements.closeLoginModalButton.addEventListener('click', () => {
    setLoginModalOpen(false);
  });
  elements.loginModalBackdrop.addEventListener('click', () => {
    setLoginModalOpen(false);
  });
  elements.runNowModeButton.addEventListener('click', () => {
    setTaskMode('run_now');
  });
  elements.dailyTaskModeButton.addEventListener('click', () => {
    setTaskMode('daily_task');
  });
  elements.taskAccountSelect.addEventListener('change', async () => {
    const accountId = elements.taskAccountSelect.value;
    if (!accountId) {
      renderTaskAccountSelect();
      updateRunAvailability();
      return;
    }

    const result = await desktopApi.setActiveXhsAccount(accountId);
    if (!result?.ok) {
      appendLog({
        level: 'warn',
        timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
        message: result?.error || '账号切换失败。'
      });
      renderTaskAccountSelect();
      updateRunAvailability();
      return;
    }

    loginController.updateLoginUI(result.xhsLogin || {});
    renderTaskAccountSelect();
    updateRunAvailability();
    appendLog({
      level: 'info',
      timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
      message: `执行账号已切换：${result.account?.displayName || accountId}`
    });
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

    if (!state.accountPool.activeAccountId) {
      appendLog({
        level: 'warn',
        timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
        message: '请先在账号管理中新增并选择执行账号。'
      });
      setLoginModalOpen(true);
      return;
    }

    if (state.taskMode === 'daily_task') {
      if (!state.aiConfig.isConfigured) {
        appendLog({
          level: 'warn',
          timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
          message: 'AI 配置不完整，请先填写 Base URL、API Key 和模型，再保存每日任务。'
        });
        setAiSettingsOpen(true);
        return;
      }

      const taskName = elements.taskNameInput.value.trim();
      const timeValue = elements.dailyTimeInput.value || '09:30';
      const enabled = elements.taskEnabledInput.checked;
      const response = await desktopApi.saveDailyTask({
        taskId: state.dailyTaskDraft.taskId || undefined,
        name: taskName || buildDailyTaskTitle(),
        query,
        scheduleType: 'daily',
        scheduleTime: timeValue,
        enabled,
      });
      if (!response?.ok || !response?.task) {
        appendLog({
          level: 'warn',
          timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
          message: response?.error || '每日任务保存失败。'
        });
        return;
      }

      hydrateDailyTaskDraft(response.task);
      elements.taskNameInput.value = state.dailyTaskDraft.name;
      elements.dailyTimeInput.value = state.dailyTaskDraft.time;
      elements.taskEnabledInput.checked = state.dailyTaskDraft.enabled;
      updateDailyTaskDraftCard();
      updateRunStatus('每日任务已保存', '已接入本地定时调度，应用运行期间会按天自动触发搜索。');
      appendLog({
        level: 'success',
        timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
        message: `已保存每日任务：${state.dailyTaskDraft.name || buildDailyTaskTitle()} · 每天 ${timeValue} · ${enabled ? '启用' : '暂停'}`
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

  elements.queryInput.addEventListener('input', () => {
    updateDailyTaskDraftCard();
  });
  elements.taskNameInput.addEventListener('input', () => {
    state.dailyTaskDraft.name = elements.taskNameInput.value.trim();
    updateDailyTaskDraftCard();
  });
  elements.dailyTimeInput.addEventListener('input', () => {
    state.dailyTaskDraft.time = elements.dailyTimeInput.value || '09:30';
    state.dailyTaskDraft.nextRunAt = '';
    updateDailyTaskDraftCard();
  });
  elements.taskEnabledInput.addEventListener('change', () => {
    state.dailyTaskDraft.enabled = elements.taskEnabledInput.checked;
    updateDailyTaskDraftCard();
  });

  elements.stopButton.addEventListener('click', async () => {
    await desktopApi.cancelRun();
  });

  elements.docButton.addEventListener('click', () => {
    desktopApi.openExternal('https://www.xiaohongshu.com');
  });

  window.addEventListener('library-state-updated', () => {
    updateHomeDashboard();
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.isLoginModalOpen) {
      setLoginModalOpen(false);
      return;
    }
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
    if (event.key === 'Escape' && !elements.competitorPage.hidden) {
      showHomePage();
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
    renderTaskAccountSelect();
    updateHomeDashboard();
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
      updateHomeDashboard();
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
    updateHomeDashboard();
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
