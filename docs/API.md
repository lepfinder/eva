# EVA 本地 HTTP REST API 开发者接口文档

EVA 内置了针对本地 AI Agent、自动化工作流（如 Dify、LangChain、AutoGPT、FastGPT、n8n）及脚本设计的轻量级 REST API 服务。

---

## 1. 基础说明

### 1.1 服务地址与端口
* **默认基础 URL**：`http://127.0.0.1:14220`
* **网络安全**：严格绑定 `127.0.0.1` 本地回环地址，仅限本机进程访问，拒绝外部网络请求。
* **端口与开关配置**：可在 EVA 桌面端「设置 -> API 服务」中自定义端口与启停服务。

### 1.2 鉴权方式（Bearer Token）
除 `/api/health` 外，所有接口均需要在 HTTP Request Header 中携带访问令牌：

```http
Authorization: Bearer <your-token>
```

> 💡 **提示**：默认 Token 为 `eva-local-token`，可在 EVA 客户端「设置 -> API 服务」中直接修改或点击「随机生成新 Token」。

### 1.3 通用响应格式
* **数据编码**：`application/json; charset=utf-8`
* **跨域支持 (CORS)**：已内置支持 `OPTIONS` 预检与 `Access-Control-Allow-Origin: *`（仅作用于本地回环）。
* **错误响应示例**（HTTP 401 / 400 / 404 / 500）：
  ```json
  {
    "error": "Unauthorized: Missing or invalid Bearer token",
    "statusCode": 401
  }
  ```

---

## 2. 接口详细列表

### 2.1 系统与全景感知

#### `GET /api/health` — 服务健康检查
无需 Token 鉴权，用于检测 API 服务是否正常存活。

* **cURL 示例**：
  ```bash
  curl -i http://127.0.0.1:14220/api/health
  ```
* **返回示例**：
  ```json
  {
    "status": "ok",
    "version": "0.1.0",
    "service": "EVA Local Intelligence API"
  }
  ```

---

#### `GET /api/context` — 桌面全景上下文（Agent 核心推荐）
一键获取当前前台聚焦应用、窗口标题、所在项目、今日工作时长概览、最新剪贴板内容以及本地正在监听的开发服务端口。

* **cURL 示例**：
  ```bash
  curl -s -H "Authorization: Bearer eva-local-token" \
    http://127.0.0.1:14220/api/context
  ```
* **返回示例**：
  ```json
  {
    "timestamp": 1786694104073,
    "activeWindow": {
      "appName": "Cursor",
      "windowTitle": "API.md — eva (Workspace)",
      "projectName": "eva"
    },
    "todayProductivity": {
      "date": "2026-08-14",
      "totalMinutes": 269,
      "topApps": [
        { "appName": "Electron", "percentage": 28, "totalDuration": 4544 },
        { "appName": "Cursor", "percentage": 25, "totalDuration": 4194 },
        { "appName": "Google Chrome", "percentage": 6, "totalDuration": 1030 }
      ],
      "categories": [
        { "category": "development", "percentage": 31, "totalDuration": 5059 },
        { "category": "productivity", "percentage": 6, "totalDuration": 985 }
      ]
    },
    "latestClipboard": {
      "id": "c745d6a0-851d-4d82-bac5-10dd6ca04b91",
      "type": "html",
      "content": "API 文档",
      "preview": "API 文档",
      "sourceApp": "Cursor",
      "timestamp": 1786693840961
    },
    "listeningPorts": [
      {
        "protocol": "tcp",
        "localAddress": "127.0.0.1",
        "port": 1420,
        "pid": 73789,
        "processName": "node",
        "command": "node"
      }
    ]
  }
  ```

---

### 2.2 用户活动与生产力

#### `GET /api/activity/current` — 获取当前活跃窗口
获取用户当前正在操作的前台应用与窗口信息。

* **cURL 示例**：
  ```bash
  curl -s -H "Authorization: Bearer eva-local-token" \
    http://127.0.0.1:14220/api/activity/current
  ```
* **返回示例**：
  ```json
  {
    "appName": "Google Chrome",
    "windowTitle": "GitHub - eva",
    "projectName": null
  }
  ```

---

#### `GET /api/activity/today` — 获取活动与时长统计
获取指定日期的应用使用时长排行榜、分类统计与项目占比。

* **Query 参数**：
  * `date` (可选)：日期字符串，格式 `YYYY-MM-DD`（默认当天）。
* **cURL 示例**：
  ```bash
  curl -s -H "Authorization: Bearer eva-local-token" \
    "http://127.0.0.1:14220/api/activity/today?date=2026-08-14"
  ```
* **返回示例**：
  ```json
  {
    "date": "2026-08-14",
    "totalSeconds": 16140,
    "totalMinutes": 269,
    "apps": [
      { "appName": "Cursor", "totalDuration": 4194, "percentage": 25 },
      { "appName": "Google Chrome", "totalDuration": 1030, "percentage": 6 }
    ],
    "categories": [
      { "category": "development", "totalDuration": 5059, "percentage": 31 }
    ],
    "projects": [
      { "projectName": "eva", "totalDuration": 4200, "percentage": 26 }
    ]
  }
  ```

---

#### `GET /api/activity/logs` — 查询历史活动流水
按时间倒序查询详细的前台切换日志时间线。

* **Query 参数**：
  * `date` (可选)：`YYYY-MM-DD`（默认当天）。
  * `limit` (可选)：返回条数，默认 `50`。
  * `app` (可选)：按应用名过滤，如 `Cursor`。
* **cURL 示例**：
  ```bash
  curl -s -H "Authorization: Bearer eva-local-token" \
    "http://127.0.0.1:14220/api/activity/logs?limit=10&app=Cursor"
  ```

---

### 2.3 剪贴板管理

#### `GET /api/clipboard/latest` — 获取最新剪贴板内容
同时获取当前系统实时的剪贴板纯文本内容，以及 EVA 数据库中记录的最新一条结构化剪贴板条目。

* **cURL 示例**：
  ```bash
  curl -s -H "Authorization: Bearer eva-local-token" \
    http://127.0.0.1:14220/api/clipboard/latest
  ```
* **返回示例**：
  ```json
  {
    "liveText": "https://api.github.com",
    "latestHistoryItem": {
      "id": "c745d6a0-851d-4d82-bac5-10dd6ca04b91",
      "type": "text",
      "content": "https://api.github.com",
      "preview": "https://api.github.com",
      "sourceApp": "Google Chrome",
      "timestamp": 1786693840961,
      "imagePath": null,
      "language": null,
      "colorValue": null
    }
  }
  ```

---

#### `GET /api/clipboard/list` — 分页查询剪贴板历史
* **Query 参数**：
  * `limit` (可选)：默认 `20`。
  * `offset` (可选)：分页偏移量，默认 `0`。
  * `date` (可选)：按日期过滤 `YYYY-MM-DD`。
* **cURL 示例**：
  ```bash
  curl -s -H "Authorization: Bearer eva-local-token" \
    "http://127.0.0.1:14220/api/clipboard/list?limit=10&offset=0"
  ```

---

#### `GET /api/clipboard/search` — 模糊搜索剪贴板历史
* **Query 参数**：
  * `q` (必填)：搜索关键词。
  * `limit` (可选)：默认 `20`。
* **cURL 示例**：
  ```bash
  curl -s -H "Authorization: Bearer eva-local-token" \
    "http://127.0.0.1:14220/api/clipboard/search?q=Bearer"
  ```

---

### 2.4 本地环境与端口

#### `GET /api/env` 或 `GET /api/env/detect` — 扫描开发工具链
扫描本机常用开发者工具（Node.js, npm, pnpm, Rust, Cargo, Python, Docker, Git, Go, Ollama, ripgrep, ffmpeg, jq 等）的安装状态与版本号。

* **cURL 示例**：
  ```bash
  curl -s -H "Authorization: Bearer eva-local-token" \
    http://127.0.0.1:14220/api/env
  ```
* **返回示例**：
  ```json
  [
    {
      "id": "node",
      "name": "Node.js",
      "category": "Runtime",
      "installed": true,
      "version": "20.18.0",
      "path": "/usr/local/bin/node",
      "status": "ok"
    },
    {
      "id": "rust",
      "name": "Rust (rustc)",
      "category": "Runtime",
      "installed": true,
      "version": "1.93.0",
      "path": "/Users/xiyangxie/.cargo/bin/rustc",
      "status": "ok"
    }
  ]
  ```

---

#### `GET /api/ports` 或 `GET /api/ports/list` — 扫描本地监听端口
扫描所有本地处于监听状态的 TCP 端口、PID 与对应进程名称（用于诊断本地是否有服务正在运行或端口冲突）。

* **cURL 示例**：
  ```bash
  curl -s -H "Authorization: Bearer eva-local-token" \
    http://127.0.0.1:14220/api/ports
  ```

---

#### `POST /api/ports/kill` — 终止占用指定端口的进程
* **Request Body**：
  ```json
  {
    "pid": 55187
  }
  ```
* **cURL 示例**：
  ```bash
  curl -s -X POST -H "Authorization: Bearer eva-local-token" \
    -H "Content-Type: application/json" \
    -d '{"pid": 55187}' \
    http://127.0.0.1:14220/api/ports/kill
  ```

---

### 2.5 系统监控与视觉回溯

#### `GET /api/memory` — 内存分析与高消耗进程
* **Query 参数**：
  * `top` (可选)：返回进程数量，默认 `10`。
* **cURL 示例**：
  ```bash
  curl -s -H "Authorization: Bearer eva-local-token" \
    "http://127.0.0.1:14220/api/memory?top=5"
  ```

---

#### `GET /api/recall` — 视觉记忆（屏幕快照时间线）
* **Query 参数**：
  * `limit` (可选)：返回条数，默认 `20`。
* **cURL 示例**：
  ```bash
  curl -s -H "Authorization: Bearer eva-local-token" \
    "http://127.0.0.1:14220/api/recall?limit=10"
  ```

---

## 3. Agent 框架接入示例代码

### 3.1 Python (requests / httpx)
```python
import requests

class EvaClient:
    def __init__(self, base_url: str = "http://127.0.0.1:14220", token: str = "eva-local-token"):
        self.base_url = base_url.rstrip("/")
        self.headers = {"Authorization": f"Bearer {token}"}

    def get_context(self) -> dict:
        """获取当前桌面全景快照"""
        res = requests.get(f"{self.base_url}/api/context", headers=self.headers)
        res.raise_for_status()
        return res.json()

    def get_latest_clipboard(self) -> str:
        """获取最新剪贴板文本"""
        res = requests.get(f"{self.base_url}/api/clipboard/latest", headers=self.headers)
        if res.status_code == 200:
            return res.json().get("liveText", "")
        return ""

# 使用示例
eva = EvaClient()
ctx = eva.get_context()
print("当前活跃项目:", ctx.get("activeWindow", {}).get("projectName"))
```

---

### 3.2 TypeScript / JavaScript (Node.js / Browser)
```typescript
export class EvaClient {
  constructor(
    private baseUrl: string = 'http://127.0.0.1:14220',
    private token: string = 'eva-local-token'
  ) {}

  private async fetchApi<T>(path: string, options: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
    if (!res.ok) {
      throw new Error(`EVA API Error ${res.status}: ${await res.text()}`);
    }
    return res.json();
  }

  getDesktopContext() {
    return this.fetchApi<any>('/api/context');
  }

  getLatestClipboard() {
    return this.fetchApi<{ liveText: string | null; latestHistoryItem: any }>('/api/clipboard/latest');
  }
}
```

---

### 3.3 LangChain Tool 自定义工具封装
```python
from langchain.tools import tool
import requests

@tool
def get_user_desktop_context() -> str:
    """获取用户当前的桌面上下文环境，包括正在编辑的项目、活跃窗口、今日工作时长以及最近剪贴板内容。"""
    try:
        res = requests.get(
            "http://127.0.0.1:14220/api/context",
            headers={"Authorization": "Bearer eva-local-token"},
            timeout=3
        )
        if res.status_code == 200:
            return str(res.json())
        return f"Error: {res.status_code}"
    except Exception as e:
        return f"EVA API connect failed: {str(e)}"
```
