/**
 * Copy to:
 *   ~/Library/Application Support/piclist/scripts/onUploadSuccess/eva-media-ingest.js
 * And set in PicList scripts/.env:
 *   EVA_TOKEN=...
 *   EVA_API_BASE=http://127.0.0.1:14220
 *
 * Requires EVA rebuilt/restarted (or eva-cli serve) with /api/assets/ingest.
 */
async function main(ctx, extra) {
  const item = (extra && extra.galleryItem) || {}
  const imgUrl = item.imgUrl || item.url
  if (!imgUrl) {
    ctx.log.warn('[eva-media-ingest] skip: no imgUrl on galleryItem')
    return ctx
  }

  const base = (env.EVA_API_BASE || 'http://127.0.0.1:14220').replace(/\/$/, '')
  const token = env.EVA_TOKEN || 'eva-local-token'

  const body = {
    cdnUrl: imgUrl,
    filename: item.fileName || item.filename || undefined,
    localPath: item.filePath || item.path || undefined,
    mimeType: item.mimeType || item.type || undefined,
    source: 'piclist',
    tags: [],
  }

  try {
    const res = await axios.post(base + '/api/assets/ingest', body, {
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
      timeout: 8000,
      validateStatus: () => true,
    })
    if (res.status >= 200 && res.status < 300) {
      ctx.log.info('[eva-media-ingest] ok ' + res.status + ' ' + imgUrl)
    } else {
      ctx.log.error('[eva-media-ingest] HTTP ' + res.status + ' ' + JSON.stringify(res.data))
    }
  } catch (e) {
    ctx.log.error('[eva-media-ingest] failed: ' + (e && e.message ? e.message : String(e)))
  }
  return ctx
}
