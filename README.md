# EVA 桌面工作台与本地上下文感知系统

EVA 是一款基于 **Tauri v2 + React 18 + TypeScript + Rust** 构建的个人本地化智能桌面工作台，深度集成系统级活动追踪、剪贴板历史管理、视觉记忆（Visual Recall）、本地开发环境分析以及面向 AI Agent 的上下文接口。

---

## ✨ 核心特性

- ⏱️ **智能活动追踪（Activity Tracker）**：自动感知前台聚焦应用与窗口，分析日常时间投入与生产力趋势。
- 📋 **全功能剪贴板历史（Clipboard Manager）**：多类型智能识别（Text / Image / Color / Code / HTML），毫秒级搜索与快速回填。
- 📸 **视觉记忆回溯（Visual Recall）**：低开销屏幕快照时间线，帮助快速找回过去的屏幕工作状态。
- 🛠️ **本地开发环境感知（Dev Tools & Ports）**：一键检测本地工具链（Node, Rust, Python, Docker 等）与本地监听端口占用。
- 🤖 **面向 AI Agent 的 CLI 工具（`eva-cli`）**：独立命令行接口，提供 **JSON-First** 的全景上下文快照，让外部 AI Agent 轻松接入桌面感知能力。

---

## 🤖 面向 AI Agent 的 CLI（`eva-cli`）

EVA 提供了轻量独立的命令行二进制 `eva-cli`，外部 AI Agent 无需启动 GUI 窗口即可直接读取本地数据：

```bash
# 获取当前桌面全景上下文（当前前台应用、最新剪贴板、活跃端口、工作时长）
eva-cli context

# 紧凑模式（减少 Agent Token 消耗）
eva-cli --compact context

# 查询今日活动数据
eva-cli activity today

# 获取最近一条剪贴板内容
eva-cli clipboard latest

# 检测本地开发工具链
eva-cli env detect

# 扫描本地正在监听的端口与进程
eva-cli ports list
```

> 📖 **完整 CLI 参数与接口数据格式请参阅 [CLI 使用文档](docs/CLI.md)**。

---

## 🚀 本地开发与构建

### 环境要求
- Node.js >= 18
- Rust >= 1.77
- macOS / Linux / Windows

### 安装依赖
```bash
npm install
```

### 开发模式（GUI 热重载）
```bash
npm run tauri:dev
```

### 运行 CLI（通过 npm）
```bash
npm run eva -- context
npm run eva -- activity today
```

### 生产打包
```bash
# 构建桌面 GUI 安装包（.app / .dmg）
npm run tauri:build

# 单独构建 CLI 工具
cd src-tauri && cargo build --release --bin eva-cli
```

---

## 📄 License

MIT License
