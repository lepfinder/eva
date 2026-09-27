# EVA 文件资源库（File Library）设计方案

> 定位：**本机文件轻索引库**——扫描指定目录、归类检索、Agent 可查询。  
> **不做**完整 DAM（不动用户原文件结构、不做评分/色标工作流、不与 Eagle/Billfish 抢地盘）。

---

## 1. 产品边界

### 1.1 要解决的问题

电脑上散落的下载、截图、文档、素材，缺少：

1. **统一入口**：不用开 Finder 翻多个目录
2. **跨目录检索**：按类型 / 时间 / 标签 / 关键词找
3. **轻组织**：打标签、智能集合，而不是重排文件夹
4. **Agent 上下文**：`/api/files/search` 让外部 AI 能查「本机有什么」

### 1.2 明确不做（v1）

| 不做 | 原因 |
|---|---|
| 自动移动/重命名用户文件 | 风险高，破坏用户习惯 |
| 云同步 / 多设备 | 与 EVA「数据不上云」一致 |
| OCR / 向量语义检索 | v2 再评估；先留扩展点 |
| 复杂评分、色标、版本管理 | DAM 领域，保持轻量 |
| 默认全盘扫描 | 必须用户显式添加根目录 |

### 1.3 与现有模块关系

| 模块 | 关系 |
|---|---|
| Navigation「资源管理」 | 仅管理导航站 favicon，**不合并**；命名避免混淆，本模块叫「文件库」 |
| Vault | 加密私密存储；文件库只读索引，不替代 Vault |
| Clipboard | 可互补（「最近复制的图」可链到文件库）；独立实现 |
| Visual Recall | 屏幕快照是自己的存储；文件库不索引 `userData/screenshots`（可配置） |
| Activity Tracker | 可共享「项目目录」概念；扫描根可建议活跃项目路径 |
| HTTP API / CLI | 新增 `/api/files/*` 与 `eva-cli files *`，鉴权与现有一致 |

---

## 2. 核心概念

```
Root（扫描根）
  └── 可配置：路径、是否递归、忽略规则、是否启用
FileEntry（索引条目）
  └── 只存元数据 + 可选缩略图；原文件始终在原路径
Tag（用户标签）
  └── many-to-many
SmartCollection（智能集合）
  └── 保存的查询条件（JSON），非物化文件夹
```

**原则：索引是投影，磁盘是唯一真相。** 删索引不删文件；文件消失则条目标记 `missing`。

---

## 3. 数据模型（SQLite）

路径：`~/Library/Application Support/com.xiyangxie.eva/userData/file-library.db`  
模式：WAL；`PRAGMA user_version` 做 schema 迁移。

```sql
-- 扫描根
CREATE TABLE scan_roots (
  id            TEXT PRIMARY KEY,
  path          TEXT NOT NULL UNIQUE,
  label         TEXT NOT NULL DEFAULT '',
  recursive     INTEGER NOT NULL DEFAULT 1,
  enabled       INTEGER NOT NULL DEFAULT 1,
  ignore_json   TEXT NOT NULL DEFAULT '[]',   -- 额外 glob，如 ["*.tmp", "node_modules"]
  last_scan_at  INTEGER,
  created_at    INTEGER NOT NULL
);

-- 文件条目
CREATE TABLE files (
  id            TEXT PRIMARY KEY,            -- uuid
  root_id       TEXT NOT NULL,
  rel_path      TEXT NOT NULL,               -- 相对 root，便于 root 迁移
  abs_path      TEXT NOT NULL,               -- 展示/打开用，可重建
  name          TEXT NOT NULL,
  ext           TEXT NOT NULL,               -- 小写，无点：png / pdf / ''
  kind          TEXT NOT NULL,               -- image|document|video|audio|archive|code|other
  size_bytes    INTEGER NOT NULL,
  mtime_ms      INTEGER NOT NULL,
  ctime_ms      INTEGER,
  content_hash  TEXT,                        -- blake3/sha256 前 64 hex，可空（大文件/关闭时）
  thumb_path    TEXT,                        -- 相对 userData/file-thumbs/ 的文件名
  missing       INTEGER NOT NULL DEFAULT 0,  -- 上次扫描未见到
  starred       INTEGER NOT NULL DEFAULT 0,
  note          TEXT NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  UNIQUE(root_id, rel_path)
);

CREATE INDEX idx_files_mtime   ON files(mtime_ms DESC);
CREATE INDEX idx_files_ext     ON files(ext);
CREATE INDEX idx_files_kind    ON files(kind);
CREATE INDEX idx_files_starred ON files(starred) WHERE starred = 1;
CREATE INDEX idx_files_missing ON files(missing);

-- 标签
CREATE TABLE tags (
  id     TEXT PRIMARY KEY,
  name   TEXT NOT NULL UNIQUE,
  color  TEXT NOT NULL DEFAULT ''
);

CREATE TABLE file_tags (
  file_id TEXT NOT NULL,
  tag_id  TEXT NOT NULL,
  PRIMARY KEY (file_id, tag_id)
);

-- 智能集合（存查询，不存文件列表）
CREATE TABLE smart_collections (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  query_json TEXT NOT NULL,   -- 见 §5.2
  sort       TEXT NOT NULL DEFAULT 'mtime_desc',
  created_at INTEGER NOT NULL
);
```

### 3.1 全文检索（v1 可选，建议尽早上）

```sql
CREATE VIRTUAL TABLE files_fts USING fts5(
  name, rel_path, note,
  content='',              -- external content 模式可后续改
  tokenize = 'unicode61 remove_diacritics 2'
);
-- 触发器或应用层同步；CJK 可先用 trigram：tokenize='trigram'
```

v1 若求快可先 `name LIKE` + 精确过滤；FTS 作为 P1 项，表结构预留。

### 3.2 分类规则 `kind`

| kind | 扩展名示例 |
|---|---|
| image | png jpg jpeg gif webp heic svg avif |
| document | pdf doc docx xls xlsx ppt pptx txt md pages numbers key |
| video | mp4 mov mkv webm m4v |
| audio | mp3 wav flac m4a aac |
| archive | zip rar 7z tar gz dmg pkg |
| code | rs ts tsx js jsx py go java swift json yaml yml toml css html |
| other | 其余 |

可在设置中用户覆盖「扩展名 → kind」映射。

---

## 4. 后端架构（Rust）

### 4.1 模块

```
src-tauri/src/file_library/
  mod.rs          -- init、SharedState、Tauri commands
  scanner.rs      -- 目录遍历、diff、忽略规则
  thumbs.rs       -- 图片缩略图（image crate）
  query.rs        -- 列表/搜索 SQL
  kinds.rs        -- 扩展名分类
```

对齐 `clipboard.rs` / `visual_recall.rs` 的拆分方式。

### 4.2 状态

```rust
pub struct FileLibraryState {
    db: Mutex<Connection>,          // 或每次 open，避免长事务卡扫描
    scan_cancel: Arc<AtomicBool>,
    scanning: Arc<AtomicBool>,
}
```

扫描必须在**独立线程**，不持锁做 IO；进度用事件推送：

```
file-library:scan-progress  { rootId, scanned, total?, phase }
file-library:scan-done      { rootId, added, updated, missing, durationMs }
file-library:scan-error     { rootId, message }
```

### 4.3 扫描策略

1. **用户触发**为主：Root 列表「立即扫描」；可选「启动后延迟扫描」（默认关）。
2. **增量**：遍历时按 `rel_path` 对比：
   - 不存在于 DB → insert
   - `mtime_ms` 或 `size_bytes` 变化 → update（可选重算 hash / 缩略图）
   - DB 有、磁盘无 → `missing=1`（保留标签/收藏）
3. **忽略**（默认内置 + root 级 ignore_json）：
   - 隐藏文件（`.` 开头）可配置
   - `node_modules` `.git` `Library` `Applications` 等
   - 单文件上限（默认 200MB，可关 hash/缩略图）
4. **并发**：线程数 = `min(4, cores)`；用 `walkdir` + 手写过滤，或 `ignore` crate 支持 gitignore 语义。
5. **取消**：`scan_cancel` 每 N 个文件检查一次。

### 4.4 缩略图

- 仅 `kind=image`，长边 ≤ 400px，JPEG q80 或 WebP
- 存 `userData/file-thumbs/<file_id>.jpg`
- 列表 API **不**返回 base64 大图；用 Tauri **asset protocol**（`tauri.conf.json` 已启用，scope 增加 `file-thumbs/**`）
- 失败则前端显示类型图标占位

### 4.5 Tauri Commands（前端调用）

| Command | 说明 |
|---|---|
| `files_roots_list` / `files_root_add` / `files_root_update` / `files_root_remove` | 管理扫描根 |
| `files_scan_start` `{ rootId? }` | 启动扫描；不传则扫全部 enabled |
| `files_scan_cancel` | 取消 |
| `files_scan_status` | 当前是否在扫 + 进度快照 |
| `files_list` `{ query }` | 分页列表，见 §5 |
| `files_get` `{ id }` | 详情 |
| `files_reveal` `{ id }` | 在 Finder 中显示（`open -R`） |
| `files_open` `{ id }` | 系统默认打开 |
| `files_star` / `files_note_set` | 收藏、备注 |
| `files_tags_list` / `files_tag_create` / `files_tag_delete` / `files_set_tags` | 标签 |
| `files_collections_*` | 智能集合 CRUD |
| `files_cleanup_missing` | 清理 missing 条目（确认后） |

路径选择：macOS 可用 `tauri-plugin-dialog` 或已有 `open` crate 对话框；v1 也可先手输路径 + 校验存在。

### 4.6 Finder 操作

```rust
// reveal
Command::new("open").args(["-R", &abs_path])
// open
open::that(&abs_path)
```

与 `navigation::open_nav_link_in_browser` / `settings::open_in_finder` 风格一致。

---

## 5. 查询与 API

### 5.1 列表查询 DTO

```json
{
  "limit": 50,
  "offset": 0,
  "kind": "image",
  "ext": "pdf",
  "rootId": "...",
  "tagIds": ["..."],
  "starred": true,
  "missing": false,
  "dateFrom": 1719792000000,
  "dateTo": 1722470400000,
  "q": "invoice",
  "sort": "mtime_desc"
}
```

返回：`{ total, items: FileItem[] }`，`FileItem` 含 `id, name, ext, kind, sizeBytes, mtimeMs, absPath, thumbUrl, tags, starred, missing`。

`thumbUrl`：`asset://localhost/<encoded path>` 或后端自定义 asset，由前端直接 `<img>`。

### 5.2 智能集合 `query_json`

与列表 query 同构（去掉分页），例如：

```json
{
  "kind": "image",
  "dateFrom": "last_7_days",
  "q": "screenshot"
}
```

`dateFrom` 支持相对写法由查询层解析。

### 5.3 本地 REST（`http_server.rs` 扩展）

| 端点 | 方法 | 说明 |
|---|---|---|
| `/api/files/stats` | GET | 各 kind 数量、root 状态、missing 数 |
| `/api/files` | GET | 同 §5.1 query string |
| `/api/files/:id` | GET | 详情 |
| `/api/files/search?q=` | GET | 简化搜索（Agent 常用） |
| `/api/files/:id/reveal` | POST | Finder 显示 |

鉴权：Bearer Token 与现有一致。  
**Agent 友好**：默认字段精简；`?compact=1` 去掉 absPath 长路径可截断。  
隐私：不把 `~/Library` 敏感路径下的条目在未显式添加 root 时暴露——本来就不会扫到。

### 5.4 CLI（`eva-cli`）

```bash
eva-cli files stats
eva-cli files search "发票" --kind document --limit 10
eva-cli files list --kind image --today
eva-cli files roots
```

---

## 6. 前端设计

### 6.1 入口

- 侧边栏新增 **「文件库」**（NavItem `filelibrary`），快捷键建议 `6`（剪贴板已是 `5`）
- `MainLayout`：title map、路由、`isFullHeightPage` 同步加上
- HUB（Option+K command 模式）可后续加「搜索文件」动作，v1 不做

### 6.2 页面布局（`FileLibraryPage.tsx`）

```
┌────────────┬──────────────────────────────────────────┐
│ 侧栏        │ 顶栏：搜索框 | kind 筛选 | 标签 | 排序 | 扫描状态 │
│ - 全部      ├──────────────────────────────────────────┤
│ - 收藏      │ 虚拟滚动网格 / 列表切换                      │
│ - 智能集合  │ 图片：缩略图卡片                            │
│ - 标签云    │ 文档：图标 + 名称 + 路径 + 时间              │
│ - 扫描根    │                                            │
│   (状态灯)  │ 选中 → 详情抽屉：预览/路径/标签/打开/收藏     │
└────────────┴──────────────────────────────────────────┘
```

实现要点：

- 复用 `@tanstack/react-virtual`（依赖已有）做网格虚拟化
- 图片用 asset URL，**禁止**再走整图 base64 IPC（吸取剪贴板教训）
- 键盘：`↑↓` 选择、`Enter` 打开、`Cmd+R` Finder、`S` 收藏、`/` 聚焦搜索
- 空状态：引导「添加扫描目录」
- 扫描中：顶栏进度条 + 可取消；允许边扫边浏览（读已入库数据）

### 6.3 扫描根管理

简单二级设置或页内弹层：

- 添加路径（对话框或粘贴）
- 递归开关、忽略规则编辑
- 「扫描 / 取消」、上次扫描时间、条目数

### 6.4 i18n

`src/i18n/locales/{zh,en}.json` 增加 `fileLibrary.*`；UI 文案与导航站资源管理区分开。

---

## 7. 安全与隐私

1. **只读用户指定 root**，不申请全盘 Full Disk Access（除非用户把受保护目录加进 root）。
2. **不上传**任何文件内容；索引仅本机。
3. REST 默认 Token；compact 输出避免整机路径泄露给不可信调用方。
4. 删除文件库 = 只删 DB 与 thumbs，**永不删原文件**。
5. 忽略规则避免误扫：`.ssh`、`Documents` 默认不自动加入，需用户确认。

---

## 8. 性能预算

| 场景 | 目标 |
|---|---|
| 扫描 1 万文件（无 hash） | < 30s（SSD） |
| 列表一页 50 条（已有缩略图） | < 50ms |
| 关键词搜索（name，1 万条） | < 100ms；FTS 后 < 30ms |
| 缩略图生成 | 仅新增/变更图片，后台队列 |
| DB 体积（1 万条元数据） | < 20MB；thumbs 另计 |

大文件：默认不算 content_hash（可 per-root 开启）；避免扫描线程把机器卡死。

---

## 9. 分期实施

### Phase 0 — 骨架（0.5–1 天）

- `file_library` 模块 + DB init + schema v1  
- roots CRUD + 手输路径  
- 空页面挂侧边栏  

### Phase 1 — 扫描与浏览（核心，2–3 天）

- 增量扫描 + 进度事件  
- kind 分类、列表/分页、mtime 排序  
- Finder reveal/open、收藏  
- 图片缩略图 + asset protocol  

### Phase 2 — 检索与组织（2 天）

- 搜索（先 LIKE name/rel_path，再 FTS）  
- kind/日期/收藏筛选  
- 标签 CRUD  
- 智能集合（内置 2–3 个 + 用户自定义）  

### Phase 3 — Agent 与打磨（1–2 天）

- REST `/api/files/*` + CLI  
- 设置页：忽略规则、启动扫描开关、缩略图开关  
- 空状态 / 错误态 / 中英文案  
- 文档：`docs/API.md`、`docs/CLI.md` 增补  

### Phase 4 — 可选增强（另立项）

- 相对时间集合、「本周下载」  
- 与剪贴板联动  
- 内容摘要 / 本地嵌入（需明确算力与隐私策略）  
- 重复文件检测（content_hash）  

---

## 10. 风险与对策

| 风险 | 对策 |
|---|---|
| 扫描卡机 / 风扇起飞 | 后台线程 + 并发上限 + 默认不算 hash；可取消 |
| 路径失效（外置盘） | `missing` 标记 + UI 提示重新扫描/修复 root |
| 权限不足（Desktop/Documents） | 扫描错误写入 root 状态，UI 引导系统设置 |
| 与「资源管理」命名冲突 | 产品名统一「文件库 / File Library」 |
| 模块继续膨胀 | 严格按 §1.2 边界；增强进 Phase 4 备忘 |

---

## 11. 成功标准（v1）

1. 添加 `~/Downloads` 后一次扫描可在 1 分钟内浏览全部图片/文档  
2. 按扩展名与关键词能稳定找到目标文件，并在 Finder 打开  
3. 收藏与标签在重启后仍在  
4. `curl` 带 Token 可搜到与 UI 一致的结果  
5. 扫描中主 UI 不卡死，可取消  

---

## 附录 A — 与剪贴板模块的差异（设计纪律）

| 点 | 文件库采用 |
|---|---|
| 轮询 | 不用 1s 轮询；用户触发扫描 |
| 大文件 IPC | 缩略图 + asset，不走 base64 |
| 锁 | 短事务；扫描与查询分离 |
| panic | command 一律返回 `Result` / 空值 |
| 删除范围 | 只删索引 |

## 附录 B — 默认忽略列表（草案）

```
node_modules
.git
.DS_Store
*.tmp
*.swp
$RECYCLE.BIN
System Volume Information
.AppleDouble
```

Root 级 `ignore_json` 在此基础上追加。
