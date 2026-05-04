const fs = require('node:fs');

const constants = require('../config/constants');

function readTaskHistoryFile() {
  if (!fs.existsSync(constants.TASK_HISTORY_FILE)) {
    return [];
  }

  try {
    const raw = fs.readFileSync(constants.TASK_HISTORY_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeTaskHistoryFile(entries) {
  fs.writeFileSync(constants.TASK_HISTORY_FILE, JSON.stringify(entries, null, 2), 'utf8');
}

function buildTaskHistoryEntry(run, { cancelled = false, failed = false, results = [] } = {}) {
  if (!run?.query) {
    return null;
  }

  const finishedAt = Date.now();
  const startedAt = typeof run.startedAt === 'number' ? run.startedAt : finishedAt;
  return {
    id: `${finishedAt}-${Math.random().toString(16).slice(2, 8)}`,
    query: run.query,
    postCount: Array.isArray(results) ? results.length : 0,
    status: cancelled ? 'cancelled' : (failed ? 'failed' : 'completed'),
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: new Date(finishedAt).toISOString(),
    durationMs: Math.max(0, finishedAt - startedAt)
  };
}

function appendTaskHistoryEntry(entry) {
  if (!entry) {
    return readTaskHistoryFile();
  }

  const nextEntries = [entry, ...readTaskHistoryFile()].slice(0, constants.MAX_TASK_HISTORY);
  writeTaskHistoryFile(nextEntries);
  return nextEntries;
}

module.exports = {
  readTaskHistoryFile,
  writeTaskHistoryFile,
  buildTaskHistoryEntry,
  appendTaskHistoryEntry
};
