export function createLogService(elements) {
  const MAX_LOG_ITEMS = 80;

  function appendLogToList(entry, targetList, template) {
    const fragment = template.content.cloneNode(true);
    const item = fragment.querySelector('.log-item');
    item.dataset.level = entry.level;
    fragment.querySelector('.log-time').textContent = entry.timestamp;
    fragment.querySelector('.log-message').textContent = entry.message;
    targetList.prepend(fragment);
    while (targetList.children.length > MAX_LOG_ITEMS) {
      targetList.removeChild(targetList.lastElementChild);
    }
  }

  function appendLog(entry) {
    appendLogToList(entry, elements.logList, elements.logItemTemplate);
    elements.logMeta.textContent = `详细过程保留最近 ${elements.logList.children.length} 条`;
  }

  function renderInternalLogs(logs) {
    elements.internalLogList.innerHTML = '';
    const safeLogs = Array.isArray(logs) ? logs : [];
    elements.internalLogEmptyState.hidden = safeLogs.length > 0;
    elements.internalLogMeta.textContent = safeLogs.length > 0
      ? `当前记录 ${safeLogs.length} 条内部诊断`
      : '等待主进程诊断日志';

    [...safeLogs].reverse().forEach((entry) => {
      const message = entry.source
        ? `[${entry.source}] ${entry.message}${entry.details ? ` | ${JSON.stringify(entry.details)}` : ''}`
        : entry.message;
      appendLogToList(
        {
          ...entry,
          message
        },
        elements.internalLogList,
        elements.internalLogItemTemplate
      );
    });
  }

  function appendInternalLog(entry) {
    const message = entry.source
      ? `[${entry.source}] ${entry.message}${entry.details ? ` | ${JSON.stringify(entry.details)}` : ''}`
      : entry.message;
    appendLogToList(
      {
        ...entry,
        message
      },
      elements.internalLogList,
      elements.internalLogItemTemplate
    );
  }

  return {
    appendLog,
    appendInternalLog,
    renderInternalLogs
  };
}
