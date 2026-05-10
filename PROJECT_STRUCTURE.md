# Project Structure

## Overview

This project is a local desktop Xiaohongshu agent tool. The current architecture is:

- Electron desktop shell for UI, IPC, login browser control, scheduling, and worker orchestration.
- Python search core for Xiaohongshu browsing, intent planning, scoring, and result extraction.
- Python desktop runtime for Electron-facing workers and SQLite persistence.
- Local SQLite / JSON files for posts, account pool, preview results, task history, AI settings, scheduled tasks, and reports.

There is no separate HTTP backend service in the current desktop version. Electron IPC is the boundary between the renderer UI and backend/runtime capabilities.

## Root Files

- `README.md`  
  User-facing overview, setup, usage, and current progress.
- `CHANGELOG.md`  
  Product-level changelog covering UI, desktop shell, search flow, reports, scheduling, and documentation.
- `BACKEND_CHANGELOG.md`  
  Backend/runtime changelog for Electron main process, Python workers, SQLite schema, and search core.
- `PROJECT_STRUCTURE.md`  
  This file.
- `package.json` / `package-lock.json`  
  Electron desktop dependencies and scripts. Current scripts are `npm start` and `npm run dev`.
- `requirements.txt`  
  Python dependencies for Playwright, OpenAI SDK, and dotenv.
- `.env`  
  Local environment configuration fallback.
- `ai_settings.json`  
  Local AI settings saved from the desktop UI. These settings take priority over `.env`.
- `xhs_agent_data.db`  
  SQLite database for post library, Xiaohongshu account pool, scheduled tasks, runs, reports, and report-post relations.
- `preview_results.json`  
  Current homepage preview results.
- `task_run_history.json`  
  Local task history shown in the task record sidebar.
- `xhs_agent_result.json`  
  Export/debug search result file.
- `xhs_browser_data_{用户名}/`  
  Local browser profile data for each Xiaohongshu account in the account pool.

## Electron Desktop

### Top-Level Entrypoints

- `electron/main.js`  
  Actual Electron main entry used by `npm start`.
- `electron/preload.js`  
  Actual preload entry that exposes `window.desktopApi`.
- `electron/renderer/index.html`  
  Main renderer HTML. Contains the home dashboard, task page, library page, report page, modals, and templates.
- `electron/renderer/styles.css`  
  Renderer styling for dashboard, task page, library, reports, modals, cards, logs, and responsive layouts.

### Main Process

- `electron/main/bootstrap/startApp.js`  
  Modular startup helper.
- `electron/main/config/constants.js`  
  Shared main-process constants.
- `electron/main/ipc/registerIpcHandlers.js`  
  IPC handler registration for renderer calls.
- `electron/main/state/runtime.js`  
  Shared runtime state for main-process services.

### Main Services

- `electron/main/services/aiConfigService.js`  
  Reads and writes OpenAI-compatible AI configuration.
- `electron/main/services/loginService.js`  
  Manages Xiaohongshu account pool, login browser, QR screenshot preview, browser visibility, active account selection, and local account data cleanup.
- `electron/main/services/searchRunService.js`  
  Starts and supervises Python search workers, handles logs, completion, cancellation, and report generation trigger.
- `electron/main/services/pythonService.js`  
  Runs Python modules and manages worker process execution.
- `electron/main/services/storageService.js`  
  Loads and mutates post library and preview result data.
- `electron/main/services/taskHistoryService.js`  
  Persists task run history.
- `electron/main/services/scheduledTaskService.js`  
  Runs local in-app polling for scheduled daily tasks.
- `electron/main/services/scheduledTaskStoreService.js`  
  Reads and writes scheduled task configuration and scheduled run state.
- `electron/main/services/dailyReportService.js`  
  Generates and reads daily report data.
- `electron/main/services/emitterService.js`  
  Emits logs and events to renderer.
- `electron/main/services/windowService.js`  
  Creates and manages the main Electron window.

### Preload

- `electron/preload/desktopApi.js`  
  Defines the desktop API exposed through `contextBridge`.
- `electron/preload/index.js`  
  Modular preload entry.

### Renderer

- `electron/renderer/scripts/app.js`  
  Renderer bootstrap, page switching, task mode management, AI settings modal, login modal, run actions, and event wiring.
- `electron/renderer/scripts/elements.js`  
  Central DOM element registry.
- `electron/renderer/scripts/state.js`  
  Renderer state store.
- `electron/renderer/scripts/loginController.js`  
  Login UI state, preview screenshot, and login action binding.
- `electron/renderer/scripts/resultsController.js`  
  Result preview, post library, sorting, filtering, pagination, selection, deletion, and report-to-post filtering.
- `electron/renderer/scripts/reportController.js`  
  Report list, report detail modal, Markdown rendering, and related post navigation.
- `electron/renderer/scripts/modalController.js`  
  Post detail modal and image zoom behavior.
- `electron/renderer/scripts/taskHistoryController.js`  
  Task history sidebar rendering and toggling.
- `electron/renderer/scripts/logService.js`  
  Runtime and internal diagnostic log rendering.
- `electron/renderer/scripts/diagnostics.js`  
  Renderer startup and runtime error display.
- `electron/renderer/scripts/utils.js`  
  Shared renderer helpers.

## Python Desktop Runtime

### Search Runner

- `desktop_runtime/search_runner/bootstrap.py`  
  Electron-facing Python worker entry. Validates config, browser data, and runs search.
- `desktop_runtime/search_runner/tool.py`  
  Desktop wrapper around the search tool.
- `desktop_runtime/search_runner/events.py`  
  JSON event emission helpers.
- `desktop_runtime/search_runner/streams.py`  
  Stream handling for worker output.
- `desktop_runtime/search_runner/constants.py`  
  Search runner constants.

### Post Store

- `desktop_runtime/post_store/cli.py`  
  CLI entry used by Electron for post, preview, scheduled task, run, and report operations.
- `desktop_runtime/post_store/repository.py`  
  SQLite repository for posts, tags, images, Xiaohongshu accounts, scheduled tasks, scheduled runs, reports, and report-post links.
- `desktop_runtime/post_store/schema.py`  
  SQLite schema setup and migrations.
- `desktop_runtime/post_store/db.py`  
  SQLite connection helpers.
- `desktop_runtime/post_store/serializers.py`  
  Post serialization helpers.
- `desktop_runtime/post_store/constants.py`  
  Database and storage constants.
- `desktop_runtime/post_store/report_generator.py`  
  Report data preparation and OpenAI-compatible report generation.

## Python Search Core

- `xhs_agent/cli.py`  
  Command-line entry for the search core.
- `xhs_agent/runner.py`  
  Main search orchestration.
- `xhs_agent/tool.py`  
  Search tool implementation.
- `xhs_agent/browser.py`  
  Browser automation and Xiaohongshu page interaction.
- `xhs_agent/intent.py`  
  Intent classification and search planning.
- `xhs_agent/scoring.py`  
  Result scoring and ranking helpers.
- `xhs_agent/config.py`  
  Runtime configuration loading.
- `xhs_agent/constants.py`  
  Shared constants.
- `xhs_agent/utils.py`  
  Shared Python helpers.

## Scripts

- `scripts/xhs_agent_tool.py`  
  Compatibility wrapper for command-line search.
- `scripts/post_store.py`  
  Compatibility wrapper for post store operations.

## Runtime Data And Generated Files

These files are local runtime artifacts and should be treated as environment/user data:

- `xhs_browser_data_*/`
- `xhs_agent_data.db`
- `preview_results.json`
- `task_run_history.json`
- `xhs_agent_result.json`
- `ai_settings.json`
- `.env`
- `__pycache__/`
- `.pycache_tmp/`
- `node_modules/`
- `.venv/`

## Recommended Commands

```bash
npm install
npm start
```

```bash
python -m scripts.xhs_agent_tool
```

```bash
python -m desktop_runtime.post_store.cli
```

## Current Page Responsibilities

- Home dashboard  
  Global state and entry points: Xiaohongshu account management, AI settings, task execution, competitor monitoring, reports, and post library.
- Task execution page  
  Active account selection, search input, immediate run, daily task configuration, live status, internal logs, result preview, and task history sidebar.
- Competitor monitoring page  
  Placeholder page for later competitor monitoring workflows.
- Post library page  
  Persistent post browsing, filtering, sorting, pagination, selection, deletion, and report-filtered post views.
- Daily report page  
  Report list, report detail view, Markdown rendering, and navigation to related posts.
- Login modal  
  Xiaohongshu account pool, login browser actions, browser visibility, account cleanup, and QR screenshot preview.
- AI settings modal  
  OpenAI-compatible Base URL, API Key, and model settings.
