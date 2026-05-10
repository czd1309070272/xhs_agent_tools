# Backend Changelog

## 2026-05-05

### Added

- 新增 Electron 主进程服务层：
  - `electron/main/services/aiConfigService.js` 管理 OpenAI 兼容接口配置。
  - `electron/main/services/loginService.js` 管理小红书登录浏览器、截图预览和本地账号数据。
  - `electron/main/services/searchRunService.js` 管理搜索 worker 生命周期、运行状态和结果回传。
  - `electron/main/services/storageService.js` 管理帖子仓库、预览结果和 SQLite / JSON 读取。
  - `electron/main/services/taskHistoryService.js` 管理任务运行历史。
  - `electron/main/services/scheduledTaskService.js` 管理应用运行期间的每日任务轮询调度。
  - `electron/main/services/scheduledTaskStoreService.js` 管理每日任务配置与运行记录持久化。
  - `electron/main/services/dailyReportService.js` 管理每日报告生成触发与报告查询。
- 新增 Electron IPC 能力：
  - AI 配置保存 / 读取。
  - 小红书登录、浏览器可见性切换、删除账号。
  - 小红书账号池列表、创建账号、切换当前账号、删除账号。
  - 立即搜索启动、取消、完成事件。
  - 帖子仓库读取、删除、预览清理。
  - 每日任务保存、读取、调度。
  - 每日报告列表、报告详情、报告关联帖子读取。
- 新增 Python 桌面运行时包 `desktop_runtime/`：
  - `desktop_runtime.search_runner` 负责 Electron 调用的搜索 worker 入口、事件流和搜索工具封装。
  - `desktop_runtime.post_store` 负责 SQLite 帖子仓库、每日任务、运行记录、每日报告和报告关联帖子存储。
- 新增 SQLite 数据能力：
  - 帖子主数据、图片、标签。
  - 每日任务配置。
  - 每日任务运行记录。
  - 每日报告 `daily_reports`。
  - 报告关联帖子 `report_posts`。
  - 小红书账号池 `xhs_accounts`。
  - 当前小红书账号状态 `xhs_account_state`。
- 新增每日报告生成模块：
  - `desktop_runtime/post_store/report_generator.py` 负责准备报告数据、解析互动数值、调用 OpenAI 兼容接口生成分析内容。
- 新增小红书账号池存储 CLI：
  - `list-xhs-accounts-file` 读取账号池。
  - `upsert-xhs-account-file` 创建或更新账号。
  - `set-active-xhs-account-file` 切换当前账号。
  - `delete-xhs-account-file` 删除账号池记录。
- 新增结构化搜索核心包 `xhs_agent/`：
  - 浏览器操作、意图识别、搜索计划、评分、运行编排、CLI 入口按职责拆分。
- 新增命令行包装入口：
  - `scripts/xhs_agent_tool.py` 调用结构化搜索核心。
  - `scripts/post_store.py` 调用结构化帖子存储 CLI。

### Changed

- Electron 后端入口调整：
  - `electron/main.js` 作为实际 `npm start` 使用入口。
  - 保留 `electron/main/` 下的模块化服务，关键启动链路仍由扁平入口保证稳定。
- Python 执行方式调整：
  - 搜索 worker 改为 `python -m desktop_runtime.search_runner.bootstrap`。
  - 帖子存储 CLI 改为 `python -m desktop_runtime.post_store.cli`。
  - 不再依赖根目录旧脚本作为桌面端运行入口。
- LLM 配置调整：
  - 桌面搜索 worker 与每日报告统一使用 OpenAI 兼容 Base URL / API Key / Model。
  - 本地 `ai_settings.json` 优先于 `.env`。
  - 保留旧环境变量兼容兜底。
- 搜索结果存储调整：
  - 搜索结果优先写入 SQLite `xhs_agent_data.db`。
  - `xhs_agent_result.json` 保留为导出和调试文件。
  - `preview_results.json` 单独保存主页预览结果，避免预览清理误伤仓库。
- 小红书登录存储调整：
  - 账号池元数据从独立 JSON 改为 SQLite。
  - 默认账号记录已移除，账号池允许为空。
  - 每个账号使用 `xhs_browser_data_{用户名}` 作为独立浏览器数据目录。
- 搜索 worker 账号目录调整：
  - Electron 主进程向 Python worker 传入当前账号 `browserDataDir`。
  - Python runner 支持从 payload / `XHS_BROWSER_DATA_DIR` 读取浏览器数据目录。
  - 桌面搜索不再固定依赖根目录 `xhs_browser_data/`。
- 每日任务调度调整：
  - 调度判定按“日期 + 时分”的槽位去重。
  - 保存每日任务不再立即触发搜索。
  - 只有应用运行期间轮询调度器会触发到点任务。
- 报告生成调整：
  - 搜索任务完成后异步触发报告生成。
  - 报告生成不阻塞 Electron 主进程和 UI。

### Fixed

- 修复 Electron preload 未注入导致渲染层按钮无响应的问题。
- 修复删除根目录旧搜索脚本后桌面端无法启动搜索的问题。
- 修复包模块直接执行时没有进入 `main()` 的问题。
- 修复 `python -m` 执行时因包初始化副作用导致的入口冲突。
- 修复任务启动前登录心跳检测干扰本地小红书登录态的问题。
- 修复每日任务保存后立即触发执行的问题。
- 修复每日任务按日期去重导致同一天改时间后不触发的问题。
- 修复每日任务触发失败后 `activeRun` 卡住，后续轮询一直跳过的问题。
- 修复报告生成同步阻塞主进程的问题。
- 修复报告服务缺少 Python 执行服务导入的问题。
- 修复报告 IPC 未暴露到 preload 导致前端无法读取报告的问题。
- 修复报告跳转帖子后无法恢复完整帖子仓库的问题。
- 修复搜索结果与数据库历史标题重复仍被收录的问题。
- 修复用户明确指定条数时 LLM 提前判定完成导致结果不足的问题。
- 修复多账号登录态只能共用固定 `xhs_browser_data/` 的问题。
- 修复登录二维码截图整窗缩小后不易扫码的问题，改为优先裁剪二维码区域并使用 PNG。

### Notes

- 当前后端是“Electron 主进程 + Python worker + SQLite 本地存储”的本地桌面架构。
- 当前没有独立 HTTP 服务端，Electron IPC 是桌面 UI 与后端能力的主要边界。
- 当前每日任务调度不具备系统后台常驻能力，应用关闭后不会触发。
- 当前报告生成依赖有效 AI 配置，未配置 OpenAI 兼容接口时无法生成报告正文。
- 当前账号池只管理本地浏览器数据目录和当前账号选择，不会上传账号凭据。
