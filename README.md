# 小红书 AI Agent 搜索工具

用自然语言描述你想找什么，Agent 自动搜索、筛选、抓取小红书内容，返回真正符合需求的帖子。

## 工作原理

```
用户自然语言输入
    ↓
LLM 解析意图 → 关键词 / 排序 / 时间范围 / 数量
    ↓
Playwright 打开小红书搜索页，应用筛选面板
    ↓
网络拦截实时捕获卡片数据（边滚动边收集）
    ↓
每批 5 条 → LLM 打分，选出最值得点击的
    ↓
点击卡片获取完整正文（优先 API 拦截，降级 DOM）
    ↓
LLM 评估正文质量，决定接受或继续换关键词
    ↓
满足需求后退出，返回结果列表
```

每轮结束后，已收录内容的标题和标签会传给下一轮，LLM 据此选择差异化的新关键词，避免结果同质化。

## 功能特性

- **自然语言驱动**：直接说"帮我找 3 篇关于 claude code 的教程"或"最近有没有好用的平价护肤品推荐"
- **小红书原生关键词**：自动使用平台流行词（测评/攻略/避坑/好物/种草等）提升搜索命中率
- **时效筛选**：说"比较新的"时，优先 15 天内，最多接受 1 个月内，超期内容自动过滤
- **动态轮次**：根据话题冷热度自动决定搜索轮数，无需手动设置；未指定数量时上限 5 条
- **跨轮去重**：已收录内容作为上下文传入，引导 LLM 补充还未覆盖的角度
- **验证码处理**：检测到滑块验证码时自动暂停，等待手动完成后继续

## 环境要求

- Python 3.10+
- DeepSeek API Key（兼容 OpenAI SDK 的接口均可）
- 小红书账号（需在浏览器中手动登录一次，之后持久保存）

## 安装

```bash
pip install -r requirements.txt
playwright install chromium
```

## 配置

在项目目录创建 `.env` 文件：

```env
OPENAI_API_KEY=your_api_key_here
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4.1-mini
```

兼容旧配置：如果你仍然使用 `DEEPSEEK_API_KEY` / `DEEPSEEK_MODEL`，当前版本也会继续识别。

## 使用

### 命令行直接运行

```bash
python -m scripts.xhs_agent_tool
```

输入需求示例：
```
请输入你的搜索需求: 帮我找几篇比较新的 claude code 使用技巧
请输入你的搜索需求: 最近热门的平价粉底液推荐，要有实测效果的
请输入你的搜索需求: 找 5 篇上海周末亲子活动攻略
```

结果保存到 `xhs_agent_result.json`。

当前版本同时会把帖子写入本地 SQLite 数据库 `xhs_agent_data.db`；`xhs_agent_result.json` 继续保留，主要用于导出和调试。

### Electron 桌面版

项目现在额外提供了一层 Electron UI 壳，已经接通真实 Python 搜索 worker，可用于：

- 搜索需求输入
- 运行状态展示
- 日志流面板
- 结果卡片预览
- 独立帖子仓库页
- 左侧任务记录侧栏
- 小红书登录态检测
- 登录浏览器启动与截图预览
- 结果详情弹层与多图查看
- 主页 AI 设置按钮（OpenAI 兼容接口）

当前进度（已同步 `2026-05-04` `CHANGELOG.md`）：

- 已完成：Electron 桌面壳、真实 Python 搜索 worker、搜索状态/日志流/结果回传链路都已接通，桌面端不再是演示模式
- 已完成：本地登录工作流已打通，支持 `xhs_browser_data/` 检测、登录浏览器拉起、5 秒截图预览、浏览器隐藏/召回、删除本地账号数据
- 已完成：结果阅读链路已补齐，桌面端支持结果卡片预览、详情弹层、标签展示、多图轮播与应用内图片放大
- 已完成：主页结果预览与独立“帖子仓库”页面已彻底分离，清理预览只影响主页，不会删除 `xhs_agent_result.json`，也不会再被 SQLite 仓库数据回填
- 已完成：帖子仓库已支持关键词搜索、默认排序、时间正序/倒序、点赞最多/收藏最多/评论最多，以及单篇删除与批量删除
- 已完成：左侧任务记录侧栏已接入本地持久化，默认收起并通过贴边标签展开，可保存任务输入、返回帖子数、完成时间和耗时，数据写入 `task_run_history.json`
- 已完成：帖子主存储已切到本地 SQLite，搜索结果写入 `xhs_agent_data.db`；Electron 优先从 SQLite 读取帖子仓库，`xhs_agent_result.json` 保留为导出和调试输出
- 已完成：桌面端已补充内部诊断日志面板，可用于排查 preload、renderer、SQLite 读取和启动链路问题
- 已完成：主页已增加 AI 设置按钮，支持为桌面搜索 worker 保存 OpenAI 兼容的 Base URL、API Key 和模型名称，本地配置优先于 `.env`
- 已完成：桌面端整体信息密度已提升，面板、按钮、输入框、日志区和帖子卡片已整体收紧；结果区默认 4 列，宽屏默认 5 列，中等宽度窗口按 4 / 3 / 2 列自适应
- 已完成：Python 运行时已开始结构化，帖子存储与桌面搜索 runner 已拆入 `desktop_runtime/`；Electron 主进程改为通过 `python -m` 调用模块入口，不再依赖根目录脚本文件路径
- 已完成：搜索核心已从单文件拆到 `xhs_agent/` 包，桌面端和命令行端已复用统一主流程；同时补上了“指定条数不提前停”“数据库标题去重后继续搜”“点击名额由 AI 决定但代码限幅”等搜索稳定性增强
- 当前结构：主进程内部服务已开始模块化拆分，但 `electron/main.js` 与 `electron/preload.js` 仍保持扁平入口，优先保证桌面端稳定启动和 `desktopApi` 注入成功
- 进行中：验证码通过后的稳定续跑
- 进行中：搜索浏览器与桌面 UI 的更细粒度联动
- 进行中：失败场景的错误分类与恢复
- 下一步：补充更明确的搜索阶段状态提示，继续优化结果阅读体验和调试工具

启动方式：

```bash
npm install
npm start
```

桌面端默认会读取项目根目录下的 `.env` 和 `xhs_browser_data/`。如果未检测到本地登录态，会提示先完成小红书登录。

Electron 相关目录：

```text
electron/
├── main.js                # Electron 主进程
├── preload.js             # 渲染层桥接 API
└── renderer/
    ├── index.html         # UI 结构
    ├── styles.css         # 桌面界面样式
    └── app.js             # 前端交互逻辑
```

桌面搜索桥接模块：

```text
desktop_runtime/search_runner/bootstrap.py   # Electron <-> Python 搜索 worker 模块入口
```

### 作为模块调用

```python
from xhs_agent import XHSAgentTool

tool = XHSAgentTool(api_key="your_key")
posts = tool.run("找几篇好用的 AI 写作工具测评")

for post in posts:
    print(post["title"], post["publishedTime"])
    print(post["content"][:200])
```

## 输出数据格式

```json
[
  {
    "id": "帖子ID",
    "url": "https://www.xiaohongshu.com/explore/...",
    "title": "帖子标题",
    "type": "normal / video",
    "author": "作者昵称",
    "author_id": "作者ID",
    "publishedTime": "3天前",
    "likes": "1234",
    "comments": "56",
    "collects": "789",
    "shares": "12",
    "content": "完整正文内容...",
    "tags": ["标签1", "标签2"],
    "images": ["图片URL1", "图片URL2"]
  }
]
```

## 注意事项

1. **首次使用**：命令行模式会在未登录时提示手动登录后继续；桌面模式会检测 `xhs_browser_data/`，未登录时可直接从界面启动登录浏览器，登录状态持久保存在 `xhs_browser_data/` 目录。

2. **分辨率依赖**：筛选面板的坐标基于 `1280x720` 实测，如需修改分辨率请同步更新 `FILTER_COORDS` 中的坐标值。

3. **正文获取**：优先通过网络拦截获取 API 返回的正文，失败时降级为 DOM 提取。小红书前端更新可能导致 DOM 选择器失效，届时需更新 `_click_card` 里的选择器列表。

4. **合理使用**：请控制抓取频率，遵守小红书服务条款，本工具仅供学习和个人研究使用。

## 项目结构

```
.
├── scripts/                   # 本地命令行包装脚本
│   ├── xhs_agent_tool.py      # 命令行搜索入口
│   └── post_store.py          # 帖子存储管理入口
├── desktop_runtime/           # 结构化 Python 运行时模块
│   ├── post_store/            # SQLite 存储、序列化与 CLI 入口
│   └── search_runner/         # 桌面搜索 runner、事件协议与启动编排
├── electron/                  # Electron 主进程、预加载和渲染层
├── package.json               # Electron 启动脚本与依赖
├── requirements.txt           # Python 依赖
├── .env                       # API Key（自行创建，不提交到 git）
├── xhs_browser_data/          # 浏览器持久化数据（自动创建，不提交到 git）
├── xhs_agent_data.db          # SQLite 帖子主存储（自动创建，不提交到 git）
├── task_run_history.json      # 任务记录本地缓存（自动创建，不提交到 git）
└── xhs_agent_result.json      # 输出结果
```

建议在 `.gitignore` 中添加：
```
.env
xhs_browser_data/
xhs_agent_data.db
xhs_agent_data.db-shm
xhs_agent_data.db-wal
xhs_agent_result.json
task_run_history.json
node_modules/
dist/
```
