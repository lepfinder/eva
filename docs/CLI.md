# EVA CLI — 面向 AI Agent 的桌面上下文智能接口

`eva-cli` 是 EVA 桌面助手的独立命令行工具，专为外部 **AI Agent、自动化工作流、终端脚本与 MCP 服务** 设计。

它提供 **JSON-First** 的高纯度结构化输出、毫秒级直接读取本地 SQLite 数据库与系统级 API，无需启动前端 GUI 即可随时获取用户桌面的全景上下文状态。

---

## 快速安装与运行

### 1. 编译并使用独立 Release 二进制（推荐）
```bash
# 编译 Release 二进制
cd src-tauri && cargo build --release --bin eva-cli

# 创建软链接至系统 PATH（可选，方便全局随时调用）
sudo ln -sf "$(pwd)/target/release/eva-cli" /usr/local/bin/eva-cli

# 直接运行
eva-cli context
```

### 2. 通过 npm 脚本运行
```bash
npm run eva -- context
npm run eva -- activity today
npm run eva -- clipboard latest
```

---

## 全局选项

- `--compact`：输出单行紧凑 JSON 格式（去除缩进与换行，大幅减少 AI Agent 上下文 Token 消耗）。
  ```bash
  eva-cli --compact context
  ```
- `-h, --help`：查看所有命令与帮助文档。
- `-V, --version`：输出版本号。

---

## 命令详解与输出格式

### 1. `eva-cli context`（桌面全景感知）
**一键获取用户当前完整工作场景**，包含当前聚焦窗口、项目名称、今日工作投入分析、最新剪贴板、本地活跃开发服务端口等。

```bash
eva-cli context
```

**返回示例**：
```json
{
  "timestamp": 1786691580000,
  "activeWindow": {
    "appName": "Cursor",
    "windowTitle": "package.json — HomeCore (Workspace)",
    "projectName": "HomeCore"
  },
  "todayProductivity": {
    "date": "2026-08-14",
    "totalMinutes": 263,
    "topApps": [
      { "appName": "Cursor", "totalDuration": 4082, "percentage": 25 },
      { "appName": "Antigravity IDE", "totalDuration": 734, "percentage": 4 }
    ],
    "categories": [
      { "category": "development", "totalDuration": 4816, "percentage": 30 },
      { "category": "productivity", "totalDuration": 925, "percentage": 5 }
    ]
  },
  "latestClipboard": {
    "id": "284ed99d-853c-466f-bb4a-457f95c7fb3d",
    "type": "text",
    "content": "npm run eva -- context",
    "sourceApp": "Antigravity IDE",
    "timestamp": 1786691187033
  },
  "listeningPorts": [
    { "protocol": "tcp", "localAddress": "127.0.0.1", "port": 1420, "pid": 73789, "processName": "node" }
  ]
}
```

---

### 2. `eva-cli activity`（活动记录与生产力）

- **`eva-cli activity current`**：获取当前聚焦的前台应用与窗口
  ```bash
  eva-cli activity current
  ```
- **`eva-cli activity today [--date YYYY-MM-DD]`**：获取指定日期的各应用时长分布、分类统计与项目排行
  ```bash
  eva-cli activity today
  eva-cli activity today --date 2026-08-14
  ```
- **`eva-cli activity logs [--limit 50] [--date YYYY-MM-DD] [--app <name>]`**：查询活动流水时间线
  ```bash
  eva-cli activity logs --limit 10 --app Cursor
  ```

---

### 3. `eva-cli clipboard`（剪贴板读写与检索）

- **`eva-cli clipboard latest`**：获取当前实时系统剪贴板文本 + 数据库最新一条结构化记录
  ```bash
  eva-cli clipboard latest
  ```
- **`eva-cli clipboard list [--limit 20] [--offset 0] [--date YYYY-MM-DD]`**：分页查询历史剪贴板列表
  ```bash
  eva-cli clipboard list --limit 10
  ```
- **`eva-cli clipboard search <query> [--limit 20] [--date YYYY-MM-DD]`**：按关键字模糊搜索剪贴板记录
  ```bash
  eva-cli clipboard search "https://github"
  ```

---

### 4. `eva-cli env`（本地开发环境检测）

- **`eva-cli env detect`**：扫描本机常用开发者工具链（Node, npm, pnpm, Rust, Cargo, Python, Docker, Git, Go, Ollama, ripgrep, ffmpeg, jq 等）的安装状态、二进制路径与版本号。
  ```bash
  eva-cli env detect
  ```

---

### 5. `eva-cli ports`（本地端口与进程）

- **`eva-cli ports list`**：扫描所有本地处于监听状态的 TCP 端口、占用进程名与 PID（如发现本地正在运行的前后端 Dev Server）。
  ```bash
  eva-cli ports list
  ```
- **`eva-cli ports kill --pid <PID>`**：终止指定 PID 的进程（用于释放端口）。
  ```bash
  eva-cli ports kill --pid 55187
  ```

---

### 6. `eva-cli memory`（系统内存与进程消耗）

- **`eva-cli memory list [--top 10]`**：统计系统物理总内存、已用/空闲内存、Swap 状态，并返回按 RSS 内存占用排序的应用进程列表。
  ```bash
  eva-cli memory list --top 5
  ```

---

### 7. `eva-cli recall`（视觉记忆与屏幕快照）

- **`eva-cli recall query [--limit 20]`**：查询近期的屏幕快照时间线，包含时间戳、关联应用、窗口标题与缩略图路径。
  ```bash
  eva-cli recall query --limit 10
  ```

### 8. `eva-cli serve`（本地常驻 HTTP API 服务）

- **`eva-cli serve [--port 14220] [--token <token>]`**：无 GUI 环境下独立启动本地 HTTP REST API 服务。
  ```bash
  eva-cli serve --port 14220 --token "eva-local-token"
  ```

---

## 本地 HTTP REST API（带 Token 鉴权）

除了命令行直接执行外，EVA 内置了高性能本地 REST API，随桌面客户端自启（默认监听 `http://127.0.0.1:14220`），并可在客户端「设置 -> API 服务」中直接开启/修改端口和 Token。

### 鉴权规范
所有 `/api/*` 请求（除了 `/api/health`）必须在请求头中携带 Bearer Token：
```http
Authorization: Bearer <your-token>
```

### 核心端点一览

| 方法 | 路径 | 描述 |
|---|---|---|
| `GET` | `/api/health` | 服务健康检查（免鉴权） |
| `GET` | `/api/context` | 桌面全景快照（活跃应用/项目、最新剪贴板、活跃端口、今日生产力） |
| `GET` | `/api/activity/current` | 当前前台活跃窗口 |
| `GET` | `/api/activity/today` | 今日活动时长、应用排行与分类统计（支持 `?date=YYYY-MM-DD`） |
| `GET` | `/api/activity/logs` | 历史活动流水记录（支持 `?limit=50&app=Cursor`） |
| `GET` | `/api/clipboard/latest` | 当前实时剪贴板文本与最近一条记录 |
| `GET` | `/api/clipboard/list` | 剪贴板历史记录列表（支持 `?limit=20&offset=0`） |
| `GET` | `/api/clipboard/search` | 关键字检索剪贴板（支持 `?q=react`） |
| `GET` | `/api/env` | 扫描本地开发工具链（Node, Rust, Python, Docker 等） |
| `GET` | `/api/ports` | 扫描本地正在监听的 TCP 端口与进程 PID |
| `POST`| `/api/ports/kill` | 释放指定端口进程（Body: `{"pid": 12345}`） |
| `GET` | `/api/memory` | 系统内存与应用内存占用分析（支持 `?top=10`） |
| `GET` | `/api/recall` | 查询视觉记忆/屏幕快照时间线 |

---

## 常见 Agent 集成方式

### 1. HTTP API 模式（推荐：适用于任何 Agent 框架、Dify、LangChain、OpenAI Assistants）

```python
import requests

EVA_API_URL = "http://127.0.0.1:14220/api/context"
HEADERS = {"Authorization": "Bearer eva-local-token"}

def get_desktop_context():
    res = requests.get(EVA_API_URL, headers=HEADERS)
    if res.status_code == 200:
        return res.json()
    return None
```

```typescript
// TypeScript / Node.js
async function getDesktopContext() {
  const res = await fetch("http://127.0.0.1:14220/api/context", {
    headers: { Authorization: "Bearer eva-local-token" },
  });
  return await res.json();
}
```

### 2. CLI 进程模式（适用于本地脚本）
```python
import subprocess, json

def get_desktop_context_cli():
    res = subprocess.run(["eva-cli", "--compact", "context"], capture_output=True, text=True)
    if res.returncode == 0:
        return json.loads(res.stdout)
    return None
```

### 3. 作为 Claude Code / Cursor / Windsurf 扩展工具
在自定义 Agent 工具或 MCP (Model Context Protocol) 服务中，将 `eva-cli` 或本地 HTTP API 封装为感知工具，使 Agent 能够：
1. 感知用户正在阅读或编辑的文件/窗口（通过 `/api/context` 或 `/api/activity/current`）。
2. 读取用户刚才复制的报错信息或链接（通过 `/api/clipboard/latest`）。
3. 检查本地环境是否有缺失的编译器或运行时（通过 `/api/env`）。
4. 确认本地开发端口是否正常启动（通过 `/api/ports`）。

