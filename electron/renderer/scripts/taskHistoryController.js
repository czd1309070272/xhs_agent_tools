import {
  formatTaskHistoryDuration,
  formatTaskHistoryTime,
  getTaskHistoryStatusLabel
} from './utils.js';

export function createTaskHistoryController({ elements, state }) {
  function setTaskHistoryOpen(nextOpen) {
    state.isTaskHistoryOpen = nextOpen;
    elements.taskHistoryShell.classList.toggle('is-open', nextOpen);
    elements.taskHistorySidebar.classList.toggle('is-open', nextOpen);
    elements.taskHistoryToggleIcon.textContent = nextOpen ? '<' : '>';
  }

  function renderTaskHistory() {
    elements.taskHistoryList.innerHTML = '';
    elements.taskHistoryEmptyState.hidden = state.taskHistoryEntries.length > 0;

    state.taskHistoryEntries.forEach((entry) => {
      const fragment = elements.taskHistoryItemTemplate.content.cloneNode(true);
      const item = fragment.querySelector('.task-history-item');
      item.dataset.status = entry.status || 'completed';
      fragment.querySelector('.task-history-status').textContent = getTaskHistoryStatusLabel(entry.status);
      fragment.querySelector('.task-history-time').textContent = formatTaskHistoryTime(entry.finishedAt);
      fragment.querySelector('.task-history-query').textContent = entry.query || '未记录任务输入';
      fragment.querySelector('.task-history-posts').textContent = `${entry.postCount || 0} 个 posts`;
      fragment.querySelector('.task-history-duration').textContent = `耗时 ${formatTaskHistoryDuration(entry.durationMs)}`;
      elements.taskHistoryList.appendChild(fragment);
    });
  }

  function prependHistoryEntry(entry) {
    state.taskHistoryEntries = [entry, ...state.taskHistoryEntries]
      .filter((item, index, list) => list.findIndex((current) => current.id === item.id) === index)
      .slice(0, 80);
    renderTaskHistory();
  }

  function bindEvents() {
    elements.taskHistoryToggleButton.addEventListener('click', () => {
      setTaskHistoryOpen(!state.isTaskHistoryOpen);
    });
  }

  return {
    setTaskHistoryOpen,
    renderTaskHistory,
    prependHistoryEntry,
    bindEvents
  };
}
