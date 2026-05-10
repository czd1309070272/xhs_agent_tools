const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const constants = require('../config/constants');
const runtime = require('../state/runtime');
const { execPythonModule } = require('./pythonService');
const { emitInternalLog } = require('./emitterService');

function withTempJsonFilePairs(task) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xhs-agent-schedule-'));
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

function toBoolean(value) {
  return Boolean(value);
}

function normalizeScheduledTask(task) {
  if (!task || typeof task !== 'object') {
    return null;
  }

  return {
    taskId: String(task.taskId || '').trim(),
    name: String(task.name || '').trim(),
    query: String(task.query || '').trim(),
    scheduleType: String(task.scheduleType || 'daily').trim() || 'daily',
    scheduleTime: String(task.scheduleTime || '09:30').trim() || '09:30',
    enabled: toBoolean(task.enabled),
    lastRunAt: task.lastRunAt || null,
    lastRunStatus: task.lastRunStatus || null,
    lastRunSummary: task.lastRunSummary || null,
    lastResultCount: task.lastResultCount === null || task.lastResultCount === undefined
      ? null
      : (Number.isFinite(Number(task.lastResultCount)) ? Number(task.lastResultCount) : null),
    lastRunTriggerType: task.lastRunTriggerType || null,
    lastScheduledFor: task.lastScheduledFor || null,
    createdAt: task.createdAt || null,
    updatedAt: task.updatedAt || null,
  };
}

function runStoreCommand(command, inputPayload = null) {
  return withTempJsonFilePairs((tempDir) => {
    const outputFile = path.join(tempDir, 'output.json');
    const args = [command];

    if (inputPayload !== null) {
      const inputFile = path.join(tempDir, 'input.json');
      fs.writeFileSync(inputFile, JSON.stringify(inputPayload, null, 2), 'utf8');
      args.push(inputFile, outputFile);
    } else {
      args.push(outputFile);
    }

    execPythonModule(constants.STORE_MODULE, args, { preferVenv: false });
    const raw = fs.readFileSync(outputFile, 'utf8');
    return JSON.parse(raw);
  });
}

function listScheduledTasks() {
  const parsed = runStoreCommand('dump-scheduled-tasks-file', null);
  const tasks = Array.isArray(parsed)
    ? parsed.map(normalizeScheduledTask).filter(Boolean)
    : [];
  runtime.scheduledTasks = tasks;
  return tasks;
}

function getPrimaryScheduledTask() {
  const tasks = runtime.scheduledTasks.length > 0 ? runtime.scheduledTasks : listScheduledTasks();
  return tasks[0] || null;
}

function saveScheduledTask(taskPayload) {
  const savedTask = normalizeScheduledTask(runStoreCommand('upsert-scheduled-task-file', taskPayload));
  const tasks = listScheduledTasks();
  const currentTask = tasks.find((task) => task.taskId === savedTask.taskId) || savedTask;
  emitInternalLog('success', 'schedule', `每日任务已保存：${currentTask.name} @ ${currentTask.scheduleTime}`);
  return currentTask;
}

function startScheduledTaskRun(runPayload) {
  const parsed = runStoreCommand('start-scheduled-task-run-file', runPayload);
  emitInternalLog('info', 'schedule', `任务执行记录已创建：${parsed.taskId} -> ${parsed.runId}`);
  return parsed;
}

function finishScheduledTaskRun(runPayload) {
  const updatedTask = normalizeScheduledTask(runStoreCommand('finish-scheduled-task-run-file', runPayload));
  const tasks = listScheduledTasks();
  return tasks.find((task) => task.taskId === updatedTask.taskId) || updatedTask;
}

module.exports = {
  finishScheduledTaskRun,
  getPrimaryScheduledTask,
  listScheduledTasks,
  saveScheduledTask,
  startScheduledTaskRun,
};
