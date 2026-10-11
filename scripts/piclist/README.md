# PicList → EVA 素材库钩子

## 正式方式（推荐）：PicList 生命周期脚本

PicList 脚本目录（数据目录内）：

```
~/Library/Application Support/piclist/scripts/onUploadSuccess/eva-media-ingest.js
~/Library/Application Support/piclist/scripts/.env
```

1. 复制仓库里的 `eva-media-ingest.piclist.js` 到上述 `onUploadSuccess/` 路径（或直接用已安装的同名文件）。
2. 在 `scripts/.env` 写入：

```
EVA_TOKEN=<与 EVA「设置 → API 服务」一致>
EVA_API_BASE=http://127.0.0.1:14220
```

3. 打开 PicList → 脚本，确认 `onUploadSuccess/eva-media-ingest.js` 已启用。
4. **需要 EVA 已包含 `/api/assets/*` 路由**（`/Applications/EVA.app` 需用本分支重新 build 安装；联调可用 `eva-cli serve --port 14221`）。

Obsidian → PicList HTTP（`127.0.0.1:36677`）上传成功后会走 gallery insert → `onUploadSuccess`。

## 备用：CLI 手工/管道入库

```bash
echo '{"imgUrl":"https://...","fileName":"a.png"}' | node scripts/piclist/on-upload-success.mjs
```

仓库根 `scripts/.env`（已 gitignore）可放 `EVA_TOKEN` / `EVA_API_BASE`。

## curl 验收

```bash
export EVA_TOKEN=...
curl -s -X POST http://127.0.0.1:14220/api/assets/ingest \
  -H "Authorization: Bearer $EVA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"cdnUrl":"https://example.com/demo.png","filename":"demo.png","source":"manual","tags":["test"]}'

curl -s -H "Authorization: Bearer $EVA_TOKEN" 'http://127.0.0.1:14220/api/assets?limit=5'
```
