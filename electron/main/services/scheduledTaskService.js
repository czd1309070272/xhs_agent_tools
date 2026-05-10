const runtime = require('../state/runtime');
const { emitInternalLog, emitLog } = require('./emitterService');
const { startPythonRun } = require('./searchRunService');
const {
  getPrimaryScheduledTask,
  listScheduledTasks,
  saveScheduledTask,
  startScheduledTaskRun,
} = require('./scheduledTaskStoreService');

const SCHEDULE_POLL_INTERVAL_MS = 30 * 1000;

function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getTimeKey(hours, minutes) {
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function parseScheduleTime(task) {
  const [hoursText, minutesText] = String(task?.scheduleTime || '').split(':');
  const hours = Number(hoursText);
  const minutes = Number(minutesText);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) {
    return null;
  }

  return { hours, minutes };
}

function getScheduledSlotKey(task, now = new Date()) {
  const schedule = parseScheduleTime(task);
  if (!schedule) {
    return null;
  }

  return `${getLocalDateKey(now)} ${getTimeKey(schedule.hours, schedule.minutes)}`;
}

function getNextRunAt(task, now = new Date()) {
  const schedule = parseScheduleTime(task) || { hours: 9, minutes: 30 };
  const next = new Date(now);
  next.setSeconds(0, 0);
  next.setHours(schedule.hours, schedule.minutes, 0, 0);

  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next;
}

function enrichScheduledTask(task) {
  if (!task) {
    return null;
  }

  return {
    ...task,
    nextRunAt: task.enabled ? getNextRunAt(task).toISOString() : null,
  };
}

function getScheduledTaskSnapshot() {
  try {
    const tasks = listScheduledTasks().map(enrichScheduledTask);
    runtime.scheduledTasks = tasks;
    return {
      tasks,
      primaryTask: tasks[0] || null,
    };
  } catch (error) {
    emitInternalLog('warn', 'schedule', `读取每日任务失败：${error.message}`);
    return {
      tasks: [],
      primaryTask: null,
    };
  }
}

async function runTaskIfDue(task, source = 'manual_check') {
  if (!task) {
    return { triggered: false, reason: 'missing_task' };
  }

  if (runtime.activeRun) {
    const ageSeconds = runtime.activeRun.startedAt
      ? Math.max(0, Math.floor((Date.now() - runtime.activeRun.startedAt) / 1000))
      : null;
    emitInternalLog(
      'info',
      'schedule',
      `跳过每日任务检查：当前已有运行中的任务，source=${source}，phase=${runtime.activeRun.phase || 'unknown'}，age=${ageSeconds ?? '?'}s`
    );
    return { triggered: false, reason: 'active_run' };
  }

  if (!shouldRunTaskNow(task)) {
    emitInternalLog(
      'info',
      'schedule',
      `每日任务当前未到触发条件，source=${source}，time=${task.scheduleTime}，lastScheduledFor=${task.lastScheduledFor || 'null'}`
    );
    return { triggered: false, reason: 'not_due' };
  }

  emitInternalLog('info', 'schedule', `每日任务满足触发条件，source=${source}，准备启动：${task.name}`);
  await triggerScheduledTask(task);
  return { triggered: true, reason: 'triggered' };
}

async function saveDailyTask(taskPayload) {
  const savedTask = enrichScheduledTask(saveScheduledTask(taskPayload));
  runtime.scheduledTasks = listScheduledTasks().map(enrichScheduledTask);
  const currentTask = runtime.scheduledTasks.find((task) => task.taskId === savedTask.taskId) || savedTask;

  // 保存任务后不立即触发，等待下一个调度周期
  emitInternalLog(
    'info',
    'schedule',
    `每日任务已保存，下次触发时间：${currentTask.nextRunAt || '未设置'}`
  );

  return currentTask;
}

function shouldRunTaskNow(task, now = new Date()) {
  if (!task || !task.enabled || task.scheduleType !== 'daily') {
    return false;
  }

  const schedule = parseScheduleTime(task);
  if (!schedule) {
    return false;
  }

  const scheduledMoment = new Date(now);
  scheduledMoment.setHours(schedule.hours, schedule.minutes, 0, 0);
  if (now.getTime() < scheduledMoment.getTime()) {
    return false;
  }

  const currentSlotKey = getScheduledSlotKey(task, now);
  if (!currentSlotKey) {
    return false;
  }

  if (task.lastScheduledFor === currentSlotKey) {
    return false;
  }

  if (task.lastScheduledFor === getLocalDateKey(now)) {
    const lastRunAt = task.lastRunAt ? new Date(task.lastRunAt) : null;
    if (lastRunAt && !Number.isNaN(lastRunAt.getTime()) && lastRunAt.getTime() >= scheduledMoment.getTime()) {
      return false;
    }
  }

  return true;
}

async function triggerScheduledTask(task) {
  const now = new Date();
  const scheduledFor = getScheduledSlotKey(task, now) || getLocalDateKey(now);
  const runRecord = startScheduledTaskRun({
    taskId: task.taskId,
    triggerType: 'scheduled',
    scheduledFor,
    startedAt: now.toISOString(),
    summary: `每日任务已触发：${task.name}`,
  });

  emitLog('info', `每日任务开始执行：${task.name} · ${task.scheduleTime}`);
  emitInternalLog('info', 'schedule', `触发每日任务：${task.taskId} @ ${task.scheduleTime}`);

  await startPythonRun({
    query: task.query,
    triggerType: 'scheduled',
    scheduledTask: {
      taskId: task.taskId,
      runId: runRecord.runId,
      taskName: task.name,
      scheduledFor,
    },
  });
}

async function checkScheduledTasks() {
  let tasks = [];
  try {
    tasks = listScheduledTasks().map(enrichScheduledTask);
  } catch (error) {
    emitInternalLog('warn', 'schedule', `轮询每日任务失败：${error.message}`);
    return;
  }
  runtime.scheduledTasks = tasks;
  const dueTask = tasks.find((task) => shouldRunTaskNow(task));
  if (!dueTask) {
    emitInternalLog('info', 'schedule', `轮询检查完成：当前没有到点的每日任务，tasks=${tasks.length}`);
    return;
  }

  try {
    await runTaskIfDue(dueTask, 'scheduler_poll');
  } catch (error) {
    emitInternalLog('warn', 'schedule', `每日任务触发失败：${error.message}`);
  }
}

function startScheduledTaskScheduler() {
  if (runtime.scheduledTaskPollTimer) {
    return;
  }

  try {
    runtime.scheduledTasks = listScheduledTasks().map(enrichScheduledTask);
  } catch (error) {
    runtime.scheduledTasks = [];
    emitInternalLog('warn', 'schedule', `每日任务初始化失败：${error.message}`);
  }
  emitInternalLog('info', 'schedule', `每日任务调度器已启动，当前任务数 ${runtime.scheduledTasks.length}。`);
  void checkScheduledTasks();
  runtime.scheduledTaskPollTimer = setInterval(() => {
    void checkScheduledTasks();
  }, SCHEDULE_POLL_INTERVAL_MS);
}

function stopScheduledTaskScheduler() {
  if (!runtime.scheduledTaskPollTimer) {
    return;
  }

  clearInterval(runtime.scheduledTaskPollTimer);
  runtime.scheduledTaskPollTimer = null;
}

module.exports = {
  getPrimaryScheduledTask,
  getScheduledTaskSnapshot,
  saveDailyTask,
  startScheduledTaskScheduler,
  stopScheduledTaskScheduler,
};
