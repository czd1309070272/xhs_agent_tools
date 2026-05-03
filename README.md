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
DEEPSEEK_API_KEY=your_api_key_here
DEEPSEEK_MODEL=deepseek-chat   # 可选，默认 deepseek-chat
```

也可以换成其他兼容 OpenAI SDK 的服务（如 OpenAI、Moonshot 等），修改 `XHSAgentTool.__init__` 里的 `base_url` 即可。

## 使用

### 命令行直接运行

```bash
python xhs_agent_tool.py
```

输入需求示例：
```
请输入你的搜索需求: 帮我找几篇比较新的 claude code 使用技巧
请输入你的搜索需求: 最近热门的平价粉底液推荐，要有实测效果的
请输入你的搜索需求: 找 5 篇上海周末亲子活动攻略
```

结果保存到 `xhs_agent_result.json`。

### 作为模块调用

```python
from xhs_agent_tool import XHSAgentTool

tool = XHSAgentTool(deepseek_api_key="your_key")
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

1. **首次使用**：脚本启动后会打开浏览器，如未登录小红书会提示手动登录，登录后按回车继续，登录状态持久保存在 `xhs_browser_data/` 目录。

2. **分辨率依赖**：筛选面板的坐标基于 `1280x720` 实测，如需修改分辨率请同步更新 `FILTER_COORDS` 中的坐标值。

3. **正文获取**：优先通过网络拦截获取 API 返回的正文，失败时降级为 DOM 提取。小红书前端更新可能导致 DOM 选择器失效，届时需更新 `_click_card` 里的选择器列表。

4. **合理使用**：请控制抓取频率，遵守小红书服务条款，本工具仅供学习和个人研究使用。

## 项目结构

```
.
├── xhs_agent_tool.py      # 主程序
├── requirements.txt       # 依赖
├── .env                   # API Key（自行创建，不提交到 git）
├── xhs_browser_data/      # 浏览器持久化数据（自动创建，不提交到 git）
└── xhs_agent_result.json  # 输出结果
```

建议在 `.gitignore` 中添加：
```
.env
xhs_browser_data/
xhs_agent_result.json
```
