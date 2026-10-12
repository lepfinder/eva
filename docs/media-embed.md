# Media library semantic index (EmbeddingGemma 2)

## Runtime
- Ollama ≥ 0.40 (multimodal embed API)
- Model: `embeddinggemma-2` (768-d, text + image)
- Optional caption VLM: `qwen3-vl:8b` (or any Ollama vision chat model)
- Default base URL: `http://127.0.0.1:11434`

## What ships
- SQLite tables `asset_embeddings` + `embed_queue` in `media-assets.db`
- Assets column `caption` for AI image descriptions
- Text query → embed with retrieval prefix → cosine top-k
- Image assets: download/thumbnail → Ollama embed with `<|image|>` + `images[]`
- New uploads enqueue + background index
- Coarse auto-tags from nearest labeled neighbors (kind `auto`)
- UI: 「语义」toggle, 「开始索引」background worker + stop, settings dialog (Ollama URL / model)
- Index/caption run on background threads (no UI freeze); progress via stats poll + events
- Grid badges: 已索引 / 未索引 / 索引失败 / 排队中
- Detail: embed status, model, indexed_at, error; AI caption + 「生成描述」

## Commands
- `media_embed_list_statuses` / `media_embed_get_asset_info`
- `media_embed_start_indexing` / `media_embed_stop_indexing` — background loop until queue empty
- `media_embed_start_caption` — background VLM caption; events `media-embed://caption-done|error`
- `media_embed_generate_caption` (legacy sync) → Ollama `/api/chat` + image → stores `assets.caption`
- Events: `media-embed://index-progress|index-done|index-error`

## Deferred
- Auto-caption on every index when `captionEnabled` (currently on-demand via UI)
- sqlite-vec / ANN index (current: brute-force cosine; fine for thousands of assets)
- Video/audio frame/chunk embeddings
