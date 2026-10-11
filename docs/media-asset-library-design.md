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

### Phase B（已实现）

- 极简阿里云 OSS 图床（密钥进钥匙串）+ 设置页「图床」
- PicList 兼容 `POST/OPTIONS /upload`（JSON `list` + multipart `image`/`file`）
- 额外监听 **36677**（可关）；亦挂在 **14220**
- 上传成功自动 ingest（`source=eva-upload`）
- 详见下文 §7

### 明确后置

- EmbeddingGemma 2 画面语义检索
- Cloudflare R2 实际上传（配置位已留）
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

推荐：PicList 生命周期脚本目录

```
~/Library/Application Support/piclist/scripts/onUploadSuccess/eva-media-ingest.js
~/Library/Application Support/piclist/scripts/.env   # EVA_TOKEN / EVA_API_BASE
```

仓库模板：`scripts/piclist/eva-media-ingest.piclist.js`。在 PicList「脚本」页确认启用。  
Obsidian → PicList HTTP（`127.0.0.1:36677`）上传成功后会触发 `onUploadSuccess`。

备用 CLI：`scripts/piclist/on-upload-success.mjs`（stdin/argv JSON）。详见 `scripts/piclist/README.md`。

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

---

## 7. Phase B — 极简图床 + PicList 兼容上传（已实现）

### 目标

EVA 内置阿里云 OSS 直传，暴露与 PicList 兼容的本地上传口，上传成功自动写入素材库（`source=eva-upload`）。PicList GUI 可逐步卸掉，不必先删。

### 配置

- 非密钥：`userData/cdn_config.json`（provider / bucket / area / pathPrefix / customUrl / piclistCompat*）
- 密钥：macOS Keychain `com.xiyangxie.eva.cdn` / `aliyun-access-key-secret`（失败时回落 `userData/.cdn_aliyun_secret`，权限 600，已 gitignore）
- UI：设置 → **图床**（掩码展示、测试连接、从 PicList `data.json` 导入）

### HTTP

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| `OPTIONS` | `/upload` | 无 | CORS / 探测 |
| `POST` | `/upload` | **无**（仅绑 127.0.0.1） | PicList 兼容主入口 |
| 同上 | 端口 **14220** 与可选 **36677** | | 36677 由 `piclistCompatEnabled` 控制 |

**JSON**

```json
{"list":["/abs/path.png"]}
→ {"success":true,"result":["https://..."],"message":"success"}
```

**multipart**：字段名 `image` 或 `file`。

对象键：`{pathPrefix}/YYYYMM/{timestamp}_{rand4}.{ext}`，默认 prefix=`img`。

无自定义域名时 URL：`https://{bucket}.{area}.aliyuncs.com/{key}`。

### Obsidian 迁移

1. 退出 PicList（释放 36677）或改插件到 `http://127.0.0.1:14220/upload`
2. EVA 开启图床 +（可选）兼容端口
3. 设置页「从 PicList 导入」或手填 OSS
4. 粘贴一张图验收：CDN 链接 + 素材库出现 `eva-upload` 条目

### 明确不做（Phase B）

- R2 实际上传（配置位已留）
- Embedding / 全量相册同步
- 复刻 PicList 相册 GUI / 多图床插件市场
