#!/usr/bin/env node
/**
 * PicList onUploadSuccess → EVA Media Assets ingest
 *
 * Usage:
 *   echo '{"imgUrl":"https://...","fileName":"a.png"}' | node on-upload-success.mjs
 *   PICLIST_RESULT='{"imgUrl":"..."}' node on-upload-success.mjs
 *   node on-upload-success.mjs '{"imgUrl":"..."}'
 *
 * Env (from scripts/.env or process env):
 *   EVA_TOKEN, EVA_API_BASE (default http://127.0.0.1:14220)
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '../..')

function loadEnvFile() {
  const envPath = path.join(root, 'scripts', '.env')
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!m) continue
    const key = m[1]
    let val = m[2]
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = val
  }
}

async function readPayload() {
  if (process.argv[2]) {
    try {
      return JSON.parse(process.argv[2])
    } catch {
      // treat as URL
      return { imgUrl: process.argv[2] }
    }
  }
  if (process.env.PICLIST_RESULT) {
    return JSON.parse(process.env.PICLIST_RESULT)
  }
  if (process.env.PICGO_RESULT) {
    return JSON.parse(process.env.PICGO_RESULT)
  }
  // stdin
  const chunks = []
  for await (const c of process.stdin) chunks.push(c)
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (!raw) {
    console.error('[eva-piclist] empty payload: pass JSON via argv, PICLIST_RESULT, or stdin')
    process.exit(2)
  }
  return JSON.parse(raw)
}

function pick(obj, keys) {
  for (const k of keys) {
    if (obj && obj[k] != null && String(obj[k]).trim() !== '') return obj[k]
  }
  return undefined
}

loadEnvFile()

const base = (process.env.EVA_API_BASE || 'http://127.0.0.1:14220').replace(/\/$/, '')
const token = process.env.EVA_TOKEN || 'eva-local-token'

const raw = await readPayload()
// PicList / PicGo shapes vary
const imgUrl = pick(raw, ['imgUrl', 'url', 'cdnUrl', 'imageUrl', 'fullResult'])
  || (Array.isArray(raw?.imgUrls) ? raw.imgUrls[0] : undefined)
  || (Array.isArray(raw?.urls) ? raw.urls[0] : undefined)

if (!imgUrl || typeof imgUrl !== 'string') {
  console.error('[eva-piclist] cannot find imgUrl in payload:', JSON.stringify(raw).slice(0, 500))
  process.exit(2)
}

const fileName = pick(raw, ['fileName', 'filename', 'name']) || undefined
const localPath = pick(raw, ['filePath', 'localPath', 'path', 'fullPath']) || undefined
const mimeType = pick(raw, ['mimeType', 'mime', 'type']) || undefined
const prompt = pick(raw, ['prompt', 'promptText']) || undefined

const body = {
  cdnUrl: imgUrl,
  localPath,
  filename: fileName,
  mimeType,
  source: 'piclist',
  prompt,
  tags: Array.isArray(raw.tags) ? raw.tags : [],
  purposeTags: Array.isArray(raw.purposeTags) ? raw.purposeTags : [],
  styleTags: Array.isArray(raw.styleTags) ? raw.styleTags : [],
}

const res = await fetch(`${base}/api/assets/ingest`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(body),
})

const text = await res.text()
if (!res.ok) {
  console.error(`[eva-piclist] ingest failed HTTP ${res.status}: ${text}`)
  process.exit(1)
}
console.log(`[eva-piclist] ok ${res.status}: ${text}`)
