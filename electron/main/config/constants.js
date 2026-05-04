const path = require('node:path');

const WORKSPACE_ROOT = path.resolve(__dirname, '..', '..', '..');
const ELECTRON_ROOT = path.join(WORKSPACE_ROOT, 'electron');

module.exports = {
  WORKSPACE_ROOT,
  ELECTRON_ROOT,
  XHS_BROWSER_DATA_DIR: path.join(WORKSPACE_ROOT, 'xhs_browser_data'),
  RESULT_FILE: path.join(WORKSPACE_ROOT, 'xhs_agent_result.json'),
  PREVIEW_STATE_FILE: path.join(WORKSPACE_ROOT, 'preview_results.json'),
  AI_SETTINGS_FILE: path.join(WORKSPACE_ROOT, 'ai_settings.json'),
  PRELOAD_STATUS_FILE: path.join(WORKSPACE_ROOT, 'preload_status.json'),
  STORE_MODULE: 'desktop_runtime.post_store.cli',
  SEARCH_RUNNER_MODULE: 'desktop_runtime.search_runner.bootstrap',
  TASK_HISTORY_FILE: path.join(WORKSPACE_ROOT, 'task_run_history.json'),
  XHS_HOME_URL: 'https://www.xiaohongshu.com',
  LOGIN_WINDOW_WIDTH: 1280,
  LOGIN_WINDOW_HEIGHT: 720,
  LOGIN_PREVIEW_INTERVAL_MS: 5000,
  MAX_TASK_HISTORY: 80,
  PRELOAD_ENTRY: path.join(ELECTRON_ROOT, 'preload.js'),
  RENDERER_ENTRY: path.join(ELECTRON_ROOT, 'renderer', 'index.html'),
  WINDOW_OPTIONS: {
    width: 1280,
    height: 720,
    minWidth: 1100,
    minHeight: 680,
    backgroundColor: '#efe4d2',
    title: 'XHS Agent Desktop',
    autoHideMenuBar: true
  }
};
