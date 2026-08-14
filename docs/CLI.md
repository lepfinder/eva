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
- **`eva-cli clipboard set "<text>"`**：由 Agent 向系统剪贴板写入文本
  ```bash
  eva-cli clipboard set "export const API_KEY = '...'"
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

---

## 常见 Agent 集成方式

### 1. 在 Python Agent 中调用
```python
import subprocess, json

def get_desktop_context():
    res = subprocess.run(["eva-cli", "--compact", "context"], capture_output=True, text=True)
    if res.returncode == 0:
        return json.loads(res.stdout)
    return None
```

### 2. 作为 Claude Code / Cursor / Windsurf 扩展工具
在自定义 Agent 工具或 MCP (Model Context Protocol) 服务中，将 `eva-cli` 封装为只读感知工具，使 Agent 能够：
1. 感知用户正在阅读或编辑的文件/窗口（通过 `context` 或 `activity current`）。
2. 读取用户刚才复制的报错信息或链接（通过 `clipboard latest`）。
3. 检查本地环境是否有缺失的编译器或运行时（通过 `env detect`）。
4. 确认本地开发端口是否正常启动（通过 `ports list`）。
