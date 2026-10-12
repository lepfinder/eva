# Media library semantic index (EmbeddingGemma 2)

## Runtime
- Ollama ≥ 0.40 (multimodal embed API)
- Model: `embeddinggemma-2` (768-d, text + image)
- Default base URL: `http://127.0.0.1:11434`

## What ships
- SQLite tables `asset_embeddings` + `embed_queue` in `media-assets.db`
- Text query → embed with retrieval prefix → cosine top-k
- Image assets: download/thumbnail → Ollama embed with `<|image|>` + `images[]`
- New uploads enqueue + background index
- Coarse auto-tags from nearest labeled neighbors (kind `auto`)
- UI: 「语义」toggle, 「索引」batch, settings dialog (Ollama URL / model)

## Deferred
- Caption VLM (`captionModel` / `captionEnabled` stub) for richer Chinese labels
- sqlite-vec / ANN index (current: brute-force cosine; fine for thousands of assets)
- Video/audio frame/chunk embeddings
