const constants = require('../config/constants');
const runtime = require('../state/runtime');
const { emitInternalLog, emitLog, emitToRenderer } = require('./emitterService');
const {
  readResultsFile,
  writePreviewResultsFile
} = require('./storageService');
const { buildAiConfigSnapshot } = require('./aiConfigService');
const { spawnPythonModule } = require('./pythonService');
const { getActiveAccount } = require('./loginService');
const {
  buildTaskHistoryEntry,
  appendTaskHistoryEntry
} = require('./taskHistoryService');
const { finishScheduledTaskRun } = require('./scheduledTaskStoreService');

function finishRun({ cancelled = false, failed = false, results = null, summary = null } = {}) {
  const run = runtime.activeRun;
  const finalResults = cancelled ? [] : (Array.isArray(results) ? results : readResultsFile());
  const finalSummary = summary || (cancelled ? '任务已取消' : `搜索完成，返回 ${finalResults.length} 条结果`);

  if (!cancelled && !failed && Array.isArray(finalResults)) {
    writePreviewResultsFile(finalResults);
  }

  const historyEntry = buildTaskHistoryEntry(run, {
    cancelled,
    failed,
    results: finalResults
  });

  if (historyEntry) {
    appendTaskHistoryEntry(historyEntry);
  }

  if (run?.scheduledTask?.taskId && run?.scheduledTask?.runId) {
    try {
      finishScheduledTaskRun({
        taskId: run.scheduledTask.taskId,
        runId: run.scheduledTask.runId,
        triggerType: run.triggerType || 'scheduled',
        status: cancelled ? 'cancelled' : (failed ? 'failed' : 'completed'),
        finishedAt: new Date().toISOString(),
        resultCount: Array.isArray(finalResults) ? finalResults.length : 0,
        summary: finalSummary,
        errorMessage: failed ? (run.errorMessage || finalSummary) : null,
      });

      // 如果任务成功完成且有新增帖子，触发报告生成（异步，不阻塞）
      if (!cancelled && !failed && Array.isArray(finalResults) && finalResults.length > 0) {
        setImmediate(() => {
          try {
            const { generateDailyReport } = require('./dailyReportService');
            generateDailyReport({
              runId: run.scheduledTask.runId,
              taskId: run.scheduledTask.taskId,
              taskName: run.scheduledTask.taskName || run.query,
              query: run.query,
              postIds: finalResults.map(r => r.id).filter(Boolean),
            }).catch((reportError) => {
              emitInternalLog('warn', 'report', `报告生成失败：${reportError.message}`);
            });
          } catch (error) {
            emitInternalLog('warn', 'report', `报告生成启动失败：${error.message}`);
          }
        });
      }
    } catch (error) {
      emitInternalLog('warn', 'schedule', '每日任务运行结果回写失败。', error.message);
    }
  }

  emitToRenderer('agent:completed', {
    cancelled,
    failed,
    results: finalResults,
    summary: finalSummary,
    historyEntry
  });
  emitToRenderer('agent:status', {
    text: '待机中',
    detail: cancelled ? '任务已取消' : (failed ? '任务失败' : '任务已完成'),
    thinking: false
  });
  runtime.activeRun = null;
}

function cancelRun() {
  if (!runtime.activeRun) {
    return false;
  }

  runtime.activeRun.cancelled = true;
  if (runtime.activeRun.child && !runtime.activeRun.child.killed) {
    runtime.activeRun.child.kill();
  } else {
    finishRun({ cancelled: true, results: [], summary: '任务已取消。' });
  }
  emitLog('warn', '已停止当前任务。');
  return true;
}

function handleRunnerEvent(event) {
  if (!runtime.activeRun) {
    return;
  }

  if (event.type === 'log') {
    emitLog(event.level || 'info', event.message || '');
    return;
  }

  if (event.type === 'status') {
    if (event.stage === 'round_started') {
      emitLog('info', `开始第 ${event.round} 轮，关键词：${event.keyword}`);
      emitToRenderer('agent:status', {
        text: `第 ${event.round} 轮搜索中`,
        detail: `关键词：${event.keyword}`,
        thinking: false
      });
    } else if (event.stage === 'round_completed') {
      emitLog('info', `第 ${event.round || ''}轮结束，累计 ${event.collected}/${event.need}`);
      emitToRenderer('agent:status', {
        text: `第 ${event.round} 轮已完成`,
        detail: `累计 ${event.collected}/${event.need}`,
        thinking: false
      });
    } else if (event.stage === 'ai_thinking') {
      emitLog('info', event.message || 'AI 正在思考');
      emitToRenderer('agent:status', {
        text: 'AI 正在思考',
        detail: event.message || '正在分析当前结果并制定下一步策略',
        thinking: true
      });
    } else if (event.stage === 'ai_decision') {
      const strategyMode = event.strategy_mode || 'explore';
      const coveragePlan = event.coverage_plan || '已生成下一轮覆盖规划';
      emitLog('info', `AI 已制定下一轮策略：${strategyMode} · ${coveragePlan}`);
      emitToRenderer('agent:status', {
        text: `策略已更新：${strategyMode}`,
        detail: coveragePlan,
        thinking: false
      });
    }
    return;
  }

  if (event.type === 'result') {
    runtime.activeRun.results = Array.isArray(event.results) ? event.results : [];
    return;
  }

  if (event.type === 'error') {
    runtime.activeRun.errorMessage = event.message || 'Python 搜索执行失败。';
    emitLog('warn', runtime.activeRun.errorMessage);
  }
}

async function startPythonRun(payload) {
  if (runtime.activeRun) {
    cancelRun();
  }

  const query = typeof payload?.query === 'string' ? payload.query.trim() : '';
  if (!query) {
    emitLog('warn', '缺少搜索需求。');
    finishRun({ cancelled: true, summary: '缺少搜索需求。' });
    return;
  }

  runtime.activeRun = {
    child: null,
    cancelled: false,
    phase: 'preflight',
    query,
    triggerType: typeof payload?.triggerType === 'string' ? payload.triggerType : 'manual',
    scheduledTask: payload?.scheduledTask || null,
    startedAt: Date.now(),
    results: null,
    errorMessage: null,
    stdoutBuffer: '',
    stderrBuffer: ''
  };

  const aiConfig = buildAiConfigSnapshot();
  if (!aiConfig.isConfigured) {
    emitLog('warn', 'AI 配置不完整，请先在主页设置 Base URL、API Key 和模型。');
    finishRun({ failed: true, results: [], summary: 'AI 配置不完整，无法启动搜索。' });
    return;
  }

  if (!runtime.activeRun || runtime.activeRun.cancelled) {
    finishRun({ cancelled: true, results: [], summary: '任务已取消。' });
    return;
  }

  runtime.activeRun.phase = 'launching_worker';
  const activeAccount = getActiveAccount();
  let child = null;
  try {
    child = spawnPythonModule(constants.SEARCH_RUNNER_MODULE, [], {
      preferVenv: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        OPENAI_API_KEY: aiConfig.apiKey,
        OPENAI_BASE_URL: aiConfig.baseUrl,
        OPENAI_MODEL: aiConfig.model,
        XHS_BROWSER_DATA_DIR: activeAccount.dataDir
      }
    });
  } catch (error) {
    runtime.activeRun.errorMessage = `Python 搜索 worker 启动失败：${error.message}`;
    emitLog('warn', runtime.activeRun.errorMessage);
    finishRun({
      failed: true,
      results: [],
      summary: runtime.activeRun.errorMessage
    });
    return;
  }

  runtime.activeRun.child = child;
  runtime.activeRun.phase = 'running_worker';

  emitLog('info', `已启动 Python 搜索任务：${query}；账号：${activeAccount.displayName}`);
  emitToRenderer('agent:status', {
    text: '任务初始化中',
    detail: '正在启动 Python 搜索 worker',
    thinking: false
  });

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    if (!runtime.activeRun) {
      return;
    }

    runtime.activeRun.stdoutBuffer += chunk;
    const lines = runtime.activeRun.stdoutBuffer.split(/\r?\n/);
    runtime.activeRun.stdoutBuffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      try {
        handleRunnerEvent(JSON.parse(trimmed));
      } catch {
        emitLog('info', trimmed);
      }
    }
  });

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    if (!runtime.activeRun) {
      return;
    }

    runtime.activeRun.stderrBuffer += chunk;
    const lines = runtime.activeRun.stderrBuffer.split(/\r?\n/);
    runtime.activeRun.stderrBuffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) {
        emitLog('warn', trimmed);
      }
    }
  });

  child.on('close', (code) => {
    const run = runtime.activeRun;
    if (!run) {
      return;
    }

    if (run.cancelled) {
      finishRun({ cancelled: true });
      return;
    }

    if (code === 0) {
      finishRun({
        cancelled: false,
        failed: false,
        results: run.results,
        summary: `搜索完成，返回 ${(run.results || []).length} 条结果`
      });
      return;
    }

    finishRun({
      cancelled: false,
      failed: true,
      results: [],
      summary: run.errorMessage || `Python 进程异常退出，退出码 ${code}`
    });
  });

  child.on('error', (error) => {
    if (!runtime.activeRun) {
      return;
    }

    runtime.activeRun.errorMessage = `Python 进程启动失败：${error.message}`;
    emitLog('warn', runtime.activeRun.errorMessage);
    finishRun({
      failed: true,
      results: [],
      summary: runtime.activeRun.errorMessage
    });
  });

  child.stdin.write(JSON.stringify({
    query,
    accountId: activeAccount.accountId,
    accountName: activeAccount.displayName,
    browserDataDir: activeAccount.dataDir
  }));
  child.stdin.end();
}

module.exports = {
  startPythonRun,
  cancelRun
};
