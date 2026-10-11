# EVA 自用素材库（Media Assets）设计方案

> 定位：**自用创作素材资产库**——公众号配图、AI 生成图/视频等，带标签与提示词，可被 PicList / Agent 入库。  
> **不是**本机文件轻索引（见 `file-library-design.md`），也不是视觉回溯截屏流，更不是 AgentDeck / promptx 对外灵感站。

---

## 1. 产品边界

| 模块 | 关系 |
|---|---|
| 文件库（File Library） | 扫本机目录做索引；素材库管「已发布/已托管」的 CDN 资产与元数据，**不合并** |
| 视觉回溯 | 自动屏幕快照；素材库手动/钩子入库的创作资产 |
| 剪贴板 | 互补，不自动混入素材库 |
| AgentDeck / promptx | 编码会话与对外灵感站；素材库仅 EVA 内自用 |

### Phase A（已实现）

- SQLite：`userData/media-assets.db`（`assets` + `tags` + `asset_tags` + 可选 FTS5）
- HTTP：`POST /api/assets/ingest`、`GET /api/assets`、`GET /api/assets/:id`、`PATCH /api/assets/:id`、`GET /api/assets/tags`
- UI：侧栏 LIBRARY →「素材库」网格（筛选 / 收藏 / 详情）
- PicList：`onUploadSuccess` 脚本 POST 入库

### 明确后置

- EmbeddingGemma 2 画面语义检索
- 新图切 Cloudflare R2（老 OSS 不动）
- 扫内容工坊 Markdown 反查「用在哪篇」

---

## 2. 数据模型

路径：`~/Library/Application Support/com.xiyangxie.eva/userData/media-assets.db`  
模式：WAL；`PRAGMA foreign_keys=ON`。

```sql
CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL DEFAULT '',
  mime_type TEXT NOT NULL DEFAULT '',
  media_kind TEXT NOT NULL DEFAULT 'image', -- image|audio|video|other
  local_path TEXT,
  cdn_url TEXT,
  content_hash TEXT,
  width INTEGER, height INTEGER, duration_ms INTEGER, file_size INTEGER,
  prompt TEXT, source TEXT NOT NULL DEFAULT 'manual',
  favorite INTEGER NOT NULL DEFAULT 0, notes TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);

CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL DEFAULT 'general', -- purpose|style|general
  created_at INTEGER NOT NULL
);

CREATE TABLE asset_tags (
  asset_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  PRIMARY KEY (asset_id, tag_id)
);

CREATE VIRTUAL TABLE assets_fts USING fts5(
  id UNINDEXED, filename, prompt, notes, tags
);
```

**Upsert**：优先按 `cdn_url`，其次 `content_hash`；命中则更新字段并合并标签。

---

## 3. HTTP API（Bearer，默认 `127.0.0.1:14220`）

### `POST /api/assets/ingest`

```json
{
  "cdnUrl": "https://...",
  "localPath": "/optional/path.png",
  "filename": "cover.png",
  "mimeType": "image/png",
  "mediaKind": "image",
  "contentHash": "optional",
  "fileSize": 12345,
  "width": 1200,
  "height": 630,
  "prompt": "可选生成提示词",
  "source": "piclist",
  "tags": ["公众号"],
  "purposeTags": ["配图"],
  "styleTags": ["扁平"],
  "favorite": false,
  "notes": ""
}
```

返回 `{ "asset": {...}, "created": true|false }`，新建 `201`，更新 `200`。

### `GET /api/assets?limit=&offset=&q=&mediaKind=&favorite=&tag=`

### `GET /api/assets/:id` / `PATCH /api/assets/:id`

PATCH 可改 `filename` / `prompt` / `notes` / `favorite` / `mediaKind` / 标签数组。

---

## 4. PicList 联调

1. 复制 `scripts/piclist/on-upload-success.mjs`
2. 在 `scripts/.env` 写 `EVA_TOKEN=...`（与 EVA「设置 → API 服务」一致，默认 `eva-local-token`）
3. PicList → 设置 → 上传后脚本 / `onUploadSuccess`：指向该 `.mjs`
4. Obsidian → PicList（`127.0.0.1:36677`）HTTP 上传应触发钩子；用 curl 也可直接测 ingest

详见 `scripts/piclist/README.md`。

---

## 5. 信息架构

侧栏新增分组 **LIBRARY** → **素材库**（`mediaassets`）。  
与 MEMORY（剪贴板 / 时间审计 / 视觉回溯 / 保险箱）并列，避免和「自动记忆」混为一谈。

---

## 6. 代价与风险

| 项 | 说明 |
|---|---|
| 存储 | 仅元数据 + CDN URL；本地文件不强制复制进 EVA |
| FTS | SQLite FTS5 足够 Phase A；语义检索后置 |
| 密钥 | Token 只放 `scripts/.env`，不入库 |
| 重启 | Rust 路由需重启 EVA 后生效 |
