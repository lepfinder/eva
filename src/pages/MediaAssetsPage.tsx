import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Image as ImageIcon,
  Search,
  Star,
  RefreshCw,
  Film,
  Music,
  File as FileIcon,
  Trash2,
  Copy,
  Check,
  CloudUpload,
  Upload,
  Loader2,
  Sparkles,
  Brain,
  MoreHorizontal,
  X,
} from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { Button, buttonVariants } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import clsx from 'clsx'

interface MediaTag {
  id: string
  name: string
  kind: string
}

interface MediaAsset {
  id: string
  filename: string
  mimeType: string
  mediaKind: string
  localPath?: string | null
  cdnUrl?: string | null
  contentHash?: string | null
  width?: number | null
  height?: number | null
  durationMs?: number | null
  fileSize?: number | null
  prompt?: string | null
  source: string
  sourceRef?: string | null
  cdnProvider?: string | null
  favorite: boolean
  notes?: string | null
  caption?: string | null
  createdAt: number
  updatedAt: number
  tags: MediaTag[]
}

interface AssetListResult {
  items: MediaAsset[]
  total: number
}

interface SemanticHit {
  asset: MediaAsset
  score: number
}

interface EmbedStats {
  totalAssets: number
  indexed: number
  errors: number
  queued: number
  model: string
  enabled: boolean
  indexing?: boolean
}

interface MediaEmbedConfig {
  enabled: boolean
  ollamaBaseUrl: string
  model: string
  autoTag: boolean
  captionModel: string
  captionEnabled: boolean
}

interface AssetEmbedInfo {
  assetId: string
  status: 'ok' | 'error' | 'pending' | string
  model?: string | null
  indexedAt?: number | null
  errorMsg?: string | null
  dims?: number | null
  caption?: string | null
  queued: boolean
  captionStatus?: string | null
  captionError?: string | null
}

function KindIcon({ kind }: { kind: string }) {
  if (kind === 'video') return <Film className="h-8 w-8 opacity-40" />
  if (kind === 'audio') return <Music className="h-8 w-8 opacity-40" />
  if (kind === 'image') return <ImageIcon className="h-8 w-8 opacity-40" />
  return <FileIcon className="h-8 w-8 opacity-40" />
}

function previewUrl(asset: MediaAsset): string | null {
  if (asset.cdnUrl) return asset.cdnUrl
  return null
}

function formatBytes(n?: number | null): string {
  if (!n || n <= 0) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function formatTime(ms: number): string {
  try {
    return new Date(ms).toLocaleString('zh-CN', { hour12: false })
  } catch {
    return String(ms)
  }
}

/** 卡片用紧凑时间：一天内相对，否则 YYYY-MM-DD HH:mm */
function formatCardTime(ms: number): string {
  if (!ms || ms <= 0) return ''
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return ''
  const diffSec = Math.floor((Date.now() - d.getTime()) / 1000)
  if (diffSec < 30) return '刚刚'
  if (diffSec < 60) return `${diffSec}秒前`
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}分钟前`
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}小时前`
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function embedStatusLabel(status?: string | null, queued?: boolean): string {
  if (status === 'ok') return '已索引'
  if (status === 'error') return '索引失败'
  if (queued) return '排队中'
  return '未索引'
}

function EmbedStatusBadge({ info }: { info?: AssetEmbedInfo | null }) {
  const status = info?.status ?? 'pending'
  const label = embedStatusLabel(status, info?.queued)
  const cls =
    status === 'ok'
      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
      : status === 'error'
        ? 'border-destructive/40 bg-destructive/10 text-destructive'
        : 'border-border/80 bg-background/90 text-muted-foreground'
  return (
    <span
      className={clsx(
        'absolute left-2 top-2 z-[5] rounded-full border px-1.5 py-0.5 text-[10px] font-medium leading-none shadow-sm backdrop-blur-sm',
        cls,
      )}
      title={
        status === 'error' && info?.errorMsg
          ? info.errorMsg
          : status === 'ok' && info?.indexedAt
            ? `索引于 ${formatTime(info.indexedAt)}`
            : label
      }
    >
      {label}
    </span>
  )
}


const IMAGE_EXT = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'heic', 'heif', 'avif',
])
const MEDIA_EXT = new Set([
  ...IMAGE_EXT,
  'mp4', 'mov', 'webm', 'mkv', 'mp3', 'wav', 'aac', 'm4a', 'flac',
])

function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i + 1).toLowerCase() : ''
}

function isUploadableFile(file: File): boolean {
  if (file.type.startsWith('image/') || file.type.startsWith('video/') || file.type.startsWith('audio/')) {
    return true
  }
  return MEDIA_EXT.has(extOf(file.name))
}

function isImageFile(file: File): boolean {
  if (file.type.startsWith('image/')) return true
  return IMAGE_EXT.has(extOf(file.name))
}

function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })
}

function pasteFilename(mime: string): string {
  const ext =
    mime === 'image/jpeg' ? 'jpg'
    : mime === 'image/gif' ? 'gif'
    : mime === 'image/webp' ? 'webp'
    : 'png'
  const stamp = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const name = [
    stamp.getFullYear(),
    pad(stamp.getMonth() + 1),
    pad(stamp.getDate()),
    '_',
    pad(stamp.getHours()),
    pad(stamp.getMinutes()),
    pad(stamp.getSeconds()),
  ].join('')
  return `paste_${name}.${ext}`
}

const PAGE_SIZE = 120

interface UploadResult {
  success: boolean
  url?: string | null
  key?: string | null
  message: string
}

export function MediaAssetsPage() {
  const [items, setItems] = useState<MediaAsset[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [q, setQ] = useState('')
  const [kind, setKind] = useState<'all' | 'image' | 'video' | 'audio' | 'other'>('all')
  const [favoriteOnly, setFavoriteOnly] = useState(false)
  const [selected, setSelected] = useState<MediaAsset | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<MediaAsset | null>(null)
  const [copied, setCopied] = useState(false)
  const [copiedCardId, setCopiedCardId] = useState<string | null>(null)
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadLabel, setUploadLabel] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragDepthRef = useRef(0)
  const pageRef = useRef<HTMLDivElement>(null)
  const scrollRootRef = useRef<HTMLDivElement>(null)
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null)
  const itemsLenRef = useRef(0)
  const loadingLockRef = useRef(false)
  const hasMoreRef = useRef(true)
  const loadGenRef = useRef(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [semanticMode, setSemanticMode] = useState(false)
  const [indexing, setIndexing] = useState(false)
  const [embedStats, setEmbedStats] = useState<EmbedStats | null>(null)
  const [embedStatusMap, setEmbedStatusMap] = useState<Record<string, AssetEmbedInfo>>({})
  const [detailEmbed, setDetailEmbed] = useState<AssetEmbedInfo | null>(null)
  const [captionGenerating, setCaptionGenerating] = useState(false)
  const [embedCfgOpen, setEmbedCfgOpen] = useState(false)
  const [embedCfg, setEmbedCfg] = useState<MediaEmbedConfig | null>(null)
  const [embedCfgSaving, setEmbedCfgSaving] = useState(false)

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg)
    window.setTimeout(() => setToastMsg(null), 4000)
  }, [])

  const refreshEmbedStats = useCallback(async () => {
    try {
      const s = await invoke<EmbedStats>('media_embed_stats')
      setEmbedStats(s)
    } catch {
      /* ignore if backend not ready */
    }
    try {
      const list = await invoke<AssetEmbedInfo[]>('media_embed_list_statuses')
      const map: Record<string, AssetEmbedInfo> = {}
      for (const info of list) map[info.assetId] = info
      setEmbedStatusMap(map)
    } catch {
      /* ignore */
    }
  }, [])

  const load = useCallback(async (opts?: { append?: boolean }) => {
    const append = opts?.append ?? false
    if (append) {
      if (loadingLockRef.current || !hasMoreRef.current) return
      if (semanticMode && q.trim()) return
      setLoadingMore(true)
    } else {
      setLoading(true)
      setError(null)
      hasMoreRef.current = true
      setHasMore(true)
      loadGenRef.current += 1
    }
    const gen = loadGenRef.current
    loadingLockRef.current = true
    try {
      if (semanticMode && q.trim()) {
        const res = await invoke<{ items: SemanticHit[]; total: number }>('media_embed_semantic_search', {
          query: q.trim(),
          limit: PAGE_SIZE,
          mediaKind: kind === 'all' ? null : kind,
        })
        if (gen !== loadGenRef.current) return
        let list = res.items.map((h) => h.asset)
        if (favoriteOnly) list = list.filter((a) => a.favorite)
        setItems(list)
        itemsLenRef.current = list.length
        setTotal(favoriteOnly ? list.length : res.total)
        hasMoreRef.current = false
        setHasMore(false)
      } else {
        const offset = append ? itemsLenRef.current : 0
        const res = await invoke<AssetListResult>('media_assets_list', {
          limit: PAGE_SIZE,
          offset,
          q: q.trim() || null,
          mediaKind: kind === 'all' ? null : kind,
          favoriteOnly,
          tag: null,
        })
        if (gen !== loadGenRef.current) return
        if (append) {
          setItems((prev) => {
            const seen = new Set(prev.map((a) => a.id))
            const merged = [...prev]
            for (const a of res.items) {
              if (!seen.has(a.id)) merged.push(a)
            }
            itemsLenRef.current = merged.length
            return merged
          })
        } else {
          setItems(res.items)
          itemsLenRef.current = res.items.length
        }
        setTotal(res.total)
        const loaded = offset + res.items.length
        const more = res.items.length > 0 && loaded < res.total
        hasMoreRef.current = more
        setHasMore(more)
      }
      void refreshEmbedStats()
    } catch (e) {
      console.error('[MediaAssets] list failed', e)
      if (gen !== loadGenRef.current) return
      setError(String(e))
      if (!append) {
        setItems([])
        itemsLenRef.current = 0
        setTotal(0)
        hasMoreRef.current = false
        setHasMore(false)
      }
    } finally {
      // Only the active generation may release the lock (stale overlap must not).
      if (gen === loadGenRef.current) {
        loadingLockRef.current = false
        setLoading(false)
        setLoadingMore(false)
      }
    }
  }, [q, kind, favoriteOnly, semanticMode, refreshEmbedStats])

  useEffect(() => {
    void load()
  }, [load])

  // Infinite scroll: load next page when sentinel enters the scroll viewport.
  useEffect(() => {
    const root = scrollRootRef.current
    const sentinel = loadMoreSentinelRef.current
    if (!root || !sentinel) return
    if (semanticMode && q.trim()) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          void load({ append: true })
        }
      },
      { root, rootMargin: '240px', threshold: 0 },
    )
    io.observe(sentinel)
    return () => io.disconnect()
  }, [load, semanticMode, q, hasMore, items.length])

  useEffect(() => {
    if (!selected) {
      setDetailEmbed(null)
      setCaptionGenerating(false)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const info = await invoke<AssetEmbedInfo>('media_embed_get_asset_info', {
          assetId: selected.id,
        })
        if (!cancelled) {
          setDetailEmbed(info)
          setCaptionGenerating(info.captionStatus === 'running')
        }
      } catch {
        if (!cancelled) {
          setDetailEmbed(embedStatusMap[selected.id] ?? null)
          setCaptionGenerating(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id])

  const applyCaptionInfo = useCallback(
    (info: AssetEmbedInfo) => {
      setDetailEmbed(info)
      setEmbedStatusMap((prev) => ({ ...prev, [info.assetId]: info }))
      if (info.caption) {
        setSelected((prev) => (prev && prev.id === info.assetId ? { ...prev, caption: info.caption } : prev))
        setItems((prev) =>
          prev.map((a) => (a.id === info.assetId ? { ...a, caption: info.caption } : a)),
        )
      }
      const running = info.captionStatus === 'running'
      setCaptionGenerating(running)
      if (info.captionStatus === 'error' && info.captionError) {
        setError(info.captionError)
      }
    },
    [],
  )

  const generateCaption = async () => {
    if (!selected || captionGenerating) return
    setCaptionGenerating(true)
    setError(null)
    const assetId = selected.id
    try {
      await invoke<{ started: boolean; alreadyRunning?: boolean }>('media_embed_start_caption', {
        assetId,
      })
      setDetailEmbed((prev) =>
        prev && prev.assetId === assetId
          ? { ...prev, captionStatus: 'running', captionError: null }
          : {
              assetId,
              status: prev?.status ?? 'pending',
              queued: prev?.queued ?? false,
              caption: prev?.caption ?? selected.caption,
              captionStatus: 'running',
              captionError: null,
            },
      )
      showToast('正在生成描述…')
    } catch (e) {
      setCaptionGenerating(false)
      setError(String(e))
    }
  }

  const toggleFavorite = async (asset: MediaAsset) => {
    try {
      const updated = await invoke<MediaAsset>('media_assets_update', {
        id: asset.id,
        payload: { favorite: !asset.favorite },
      })
      setItems((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))
      if (selected?.id === updated.id) setSelected(updated)
    } catch (e) {
      console.error('[MediaAssets] favorite failed', e)
    }
  }

  const assetCopyUrl = (asset: MediaAsset): string | null => {
    const url = asset.cdnUrl?.trim() || asset.localPath?.trim() || null
    return url || null
  }

  const copyUrl = async (url: string, opts?: { cardId?: string }) => {
    try {
      await navigator.clipboard.writeText(url)
      if (opts?.cardId) {
        setCopiedCardId(opts.cardId)
        window.setTimeout(() => {
          setCopiedCardId((cur) => (cur === opts.cardId ? null : cur))
        }, 1500)
      } else {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1500)
      }
    } catch (e) {
      console.error('[MediaAssets] copy failed', e)
      setError('复制失败')
    }
  }

  const copyAsset = async (asset: MediaAsset) => {
    const url = assetCopyUrl(asset)
    if (!url) {
      setError('该素材没有可复制的 URL')
      return
    }
    await copyUrl(url, { cardId: asset.id })
  }

  const formatDeleteError = (e: unknown): string => {
    const raw = typeof e === 'string' ? e : e instanceof Error ? e.message : String(e)
    if (
      raw.includes('oss:DeleteObject') ||
      raw.includes('AccessDenied') ||
      raw.includes('拒绝删除')
    ) {
      return `云端删除被拒绝：当前 AccessKey 缺少 oss:DeleteObject 权限。本地记录未删除。\n${raw}`
    }
    return raw
  }

  const requestDelete = (asset: MediaAsset) => {
    if (deleting) return
    setError(null)
    setPendingDelete(asset)
  }

  const confirmDelete = async () => {
    const target = pendingDelete
    if (!target) return

    setDeleting(true)
    setError(null)
    setToastMsg(null)
    try {
      const res = await invoke<{ id: string; cloudDeleted: boolean; localFileDeleted: boolean }>(
        'media_assets_delete',
        { id: target.id },
      )
      setItems((prev) => prev.filter((x) => x.id !== target.id))
      setTotal((t) => Math.max(0, t - 1))
      if (selected?.id === target.id) setSelected(null)
      setPendingDelete(null)
      setToastMsg(
        res.cloudDeleted
          ? `已删除「${target.filename}」（云端 + 本地）`
          : `已删除「${target.filename}」（仅本地）`,
      )
      window.setTimeout(() => setToastMsg(null), 4000)
    } catch (e) {
      console.error('[MediaAssets] delete failed', e)
      setError(formatDeleteError(e))
      setPendingDelete(null)
    } finally {
      setDeleting(false)
    }
  }

  const uploadFiles = useCallback(
    async (files: File[]) => {
      const list = files.filter(isUploadableFile)
      if (list.length === 0) {
        setError('没有可上传的文件（支持图片 / 视频 / 音频）')
        return
      }
      // Prefer images first when mixed
      list.sort((a, b) => Number(isImageFile(b)) - Number(isImageFile(a)))

      setUploading(true)
      setError(null)
      setToastMsg(null)
      setUploadProgress(0)
      let ok = 0
      let fail = 0
      const errors: string[] = []

      for (let i = 0; i < list.length; i++) {
        const file = list[i]
        setUploadLabel(`上传中 ${i + 1}/${list.length} · ${file.name}`)
        setUploadProgress(Math.round((i / list.length) * 100))
        try {
          const dataUrl = await fileToDataUrl(file)
          const res = await invoke<UploadResult>('cdn_upload_bytes', {
            dataBase64: dataUrl,
            filename: file.name || `upload_${i + 1}.bin`,
          })
          if (res.success) {
            ok += 1
          } else {
            fail += 1
            errors.push(`${file.name}: ${res.message}`)
          }
        } catch (e) {
          fail += 1
          errors.push(`${file.name}: ${String(e)}`)
        }
        setUploadProgress(Math.round(((i + 1) / list.length) * 100))
      }

      setUploading(false)
      setUploadLabel('')
      setUploadProgress(0)

      if (ok > 0) {
        await load()
        showToast(fail > 0 ? `已上传 ${ok} 个，失败 ${fail} 个` : `已上传 ${ok} 个素材`)
      }
      if (fail > 0 && ok === 0) {
        setError(errors.slice(0, 3).join('\n'))
      } else if (fail > 0) {
        setError(errors.slice(0, 3).join('\n'))
      }
    },
    [load, showToast],
  )

  const openFilePicker = () => {
    if (uploading) return
    fileInputRef.current?.click()
  }

  const onFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : []
    e.target.value = ''
    if (files.length) void uploadFiles(files)
  }

  const onDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragDepthRef.current += 1
    if (e.dataTransfer.types.includes('Files')) setDragOver(true)
  }

  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) setDragOver(false)
  }

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.dataTransfer.types.includes('Files')) {
      e.dataTransfer.dropEffect = 'copy'
    }
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragDepthRef.current = 0
    setDragOver(false)
    if (uploading) return
    const files = Array.from(e.dataTransfer.files || [])
    if (files.length) void uploadFiles(files)
  }

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (uploading) return
      const target = e.target as HTMLElement | null
      if (target) {
        const tag = target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return
      }

      const items = e.clipboardData?.items
      if (!items?.length) return
      const imageFiles: File[] = []
      for (const item of Array.from(items)) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const blob = item.getAsFile()
          if (!blob) continue
          const name =
            blob.name && blob.name !== 'image.png'
              ? blob.name
              : pasteFilename(item.type || blob.type || 'image/png')
          imageFiles.push(new File([blob], name, { type: blob.type || item.type || 'image/png' }))
        }
      }
      if (imageFiles.length === 0) return
      e.preventDefault()
      void uploadFiles(imageFiles)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [uploadFiles, uploading])


  const runIndexBatch = async () => {
    if (indexing) return
    setIndexing(true)
    setError(null)
    try {
      const res = await invoke<{ started: boolean; alreadyRunning?: boolean; enqueued?: number }>(
        'media_embed_start_indexing',
        { batchSize: 8 },
      )
      if (res.alreadyRunning) {
        showToast('索引已在后台运行')
      } else {
        showToast(`已开始后台索引${typeof res.enqueued === 'number' ? `（入队 ${res.enqueued}）` : ''}…`)
      }
      await refreshEmbedStats()
    } catch (e) {
      setIndexing(false)
      setError(String(e))
    }
  }

  const stopIndexing = async () => {
    try {
      await invoke('media_embed_stop_indexing')
      showToast('正在停止索引…')
    } catch (e) {
      setError(String(e))
    }
  }

  // Poll embed stats while background indexing runs.
  useEffect(() => {
    if (!indexing && !embedStats?.indexing) return
    const t = window.setInterval(() => {
      void refreshEmbedStats()
    }, 1200)
    return () => window.clearInterval(t)
  }, [indexing, embedStats?.indexing, refreshEmbedStats])

  // Sync local indexing flag from stats.
  useEffect(() => {
    if (typeof embedStats?.indexing === 'boolean') {
      setIndexing(embedStats.indexing)
    }
  }, [embedStats?.indexing])

  // Poll caption status for open detail while generating.
  useEffect(() => {
    if (!selected || !captionGenerating) return
    const assetId = selected.id
    let cancelled = false
    const tick = async () => {
      try {
        const info = await invoke<AssetEmbedInfo>('media_embed_get_asset_info', { assetId })
        if (cancelled) return
        const stillRunning = info.captionStatus === 'running'
        applyCaptionInfo(info)
        if (!stillRunning) {
          if (info.captionStatus === 'error') {
            /* error surfaced via applyCaptionInfo */
          } else if (info.caption) {
            showToast('描述已生成')
          }
        }
      } catch {
        /* ignore */
      }
    }
    const t = window.setInterval(() => {
      void tick()
    }, 1500)
    void tick()
    return () => {
      cancelled = true
      window.clearInterval(t)
    }
  }, [selected?.id, captionGenerating, applyCaptionInfo, showToast])

  // Background job events.
  useEffect(() => {
    let unsubs: Array<() => void> = []
    void (async () => {
      try {
        unsubs.push(
          await listen<{ stats?: EmbedStats }>('media-embed://index-progress', (ev) => {
            if (ev.payload?.stats) setEmbedStats(ev.payload.stats)
            setIndexing(true)
            void refreshEmbedStats()
          }),
        )
        unsubs.push(
          await listen<{ stats?: EmbedStats }>('media-embed://index-done', (ev) => {
            if (ev.payload?.stats) setEmbedStats(ev.payload.stats)
            setIndexing(false)
            void refreshEmbedStats()
            showToast('索引完成')
          }),
        )
        unsubs.push(
          await listen<{ error?: string }>('media-embed://index-error', (ev) => {
            setIndexing(false)
            if (ev.payload?.error) setError(ev.payload.error)
            void refreshEmbedStats()
          }),
        )
        unsubs.push(
          await listen<AssetEmbedInfo>('media-embed://caption-done', (ev) => {
            applyCaptionInfo({ ...ev.payload, captionStatus: null, captionError: null })
            setCaptionGenerating(false)
            showToast('描述已生成')
          }),
        )
        unsubs.push(
          await listen<{ assetId: string; error: string }>('media-embed://caption-error', (ev) => {
            const { assetId, error } = ev.payload
            setCaptionGenerating(false)
            setError(error)
            setDetailEmbed((prev) =>
              prev && prev.assetId === assetId
                ? { ...prev, captionStatus: 'error', captionError: error }
                : prev,
            )
          }),
        )
      } catch {
        /* not in tauri */
      }
    })()
    return () => {
      for (const u of unsubs) u()
    }
  }, [applyCaptionInfo, refreshEmbedStats, showToast])

  const openEmbedCfg = async () => {

    try {
      const cfg = await invoke<MediaEmbedConfig>('media_embed_get_config')
      setEmbedCfg(cfg)
      setEmbedCfgOpen(true)
      void refreshEmbedStats()
    } catch (e) {
      setError(String(e))
    }
  }

  const saveEmbedCfg = async () => {
    if (!embedCfg) return
    setEmbedCfgSaving(true)
    try {
      const saved = await invoke<MediaEmbedConfig>('media_embed_save_config', {
        config: {
          enabled: embedCfg.enabled,
          ollamaBaseUrl: embedCfg.ollamaBaseUrl,
          model: embedCfg.model,
          autoTag: embedCfg.autoTag,
          captionModel: embedCfg.captionModel,
          captionEnabled: embedCfg.captionEnabled,
        },
      })
      setEmbedCfg(saved)
      setEmbedCfgOpen(false)
      showToast('智能配置已保存')
      await refreshEmbedStats()
    } catch (e) {
      setError(String(e))
    } finally {
      setEmbedCfgSaving(false)
    }
  }

  const testEmbed = async () => {
    try {
      const r = await invoke<{ ok: boolean; dims: number; elapsedMs: number; model: string }>('media_embed_test')
      showToast(`Ollama OK · ${r.model} · ${r.dims}d · ${r.elapsedMs}ms`)
    } catch (e) {
      setError(String(e))
    }
  }

  const filtersActive = kind !== 'all' || favoriteOnly

  const pendingHasCloud = Boolean(pendingDelete?.cdnUrl?.trim())

  return (
    <TooltipProvider delayDuration={300}>
      <div
        ref={pageRef}
        tabIndex={-1}
        className="relative flex h-full flex-col gap-4 outline-none"
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*,audio/*"
          multiple
          className="hidden"
          onChange={onFileInputChange}
        />
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">素材库</h1>
            <p className="text-sm text-muted-foreground mt-1">
              拖拽 / ⌘V 粘贴上传
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="font-mono text-[11px]">
              {total} 项
            </Badge>
            <Button size="sm" onClick={openFilePicker} disabled={uploading}>
              {uploading ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : (
                <Upload className="h-4 w-4 mr-1.5" />
              )}
              上传
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-9 w-9 px-0" aria-label="更多">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem
                  onClick={() => {
                    window.dispatchEvent(
                      new CustomEvent('navigate-to-page', {
                        detail: { page: 'settings', tab: 'cdn' },
                      }),
                    )
                  }}
                >
                  <CloudUpload className="h-4 w-4 mr-2" />
                  图床配置
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={loading || uploading}
                  onClick={() => void load()}
                >
                  <RefreshCw className={clsx('h-4 w-4 mr-2', loading && 'animate-spin')} />
                  刷新
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => void openEmbedCfg()}>
                  <Brain className="h-4 w-4 mr-2" />
                  智能
                  {embedStats ? (
                    <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                      {embedStats.indexed}/{embedStats.totalAssets}
                    </span>
                  ) : null}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              className="w-full h-9 rounded-md border bg-background pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              placeholder={semanticMode ? '语义搜索：描述画面 / 场景 / 风格…' : '搜索文件名 / 提示词 / 备注 / 标签'}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void load()
              }}
            />
          </div>
          <Button
            size="sm"
            variant={semanticMode ? 'secondary' : 'outline'}
            className="h-9"
            onClick={() => setSemanticMode((v) => !v)}
            title="用 EmbeddingGemma 做画面语义检索"
          >
            <Sparkles className={clsx('h-4 w-4 mr-1.5', semanticMode && 'text-violet-500')} />
            语义
          </Button>
          <div className="flex items-center gap-1 rounded-md border p-0.5">
            {(['all', 'image', 'video', 'audio', 'other'] as const).map((k) => (
              <Button
                key={k}
                size="sm"
                variant={kind === k ? 'secondary' : 'ghost'}
                className="h-8 px-2.5 text-xs"
                onClick={() => setKind(k)}
              >
                {k === 'all' ? '全部' : k === 'image' ? '图片' : k === 'video' ? '视频' : k === 'audio' ? '音频' : '其他'}
              </Button>
            ))}
          </div>
          <Button
            size="sm"
            variant={favoriteOnly ? 'secondary' : 'outline'}
            className="h-9"
            onClick={() => setFavoriteOnly((v) => !v)}
            title="仅看收藏"
          >
            <Star className={clsx('h-4 w-4', favoriteOnly && 'fill-amber-400 text-amber-400')} />
          </Button>
          {filtersActive && (
            <Button
              size="sm"
              variant="ghost"
              className="h-9"
              onClick={() => {
                setKind('all')
                setFavoriteOnly(false)
              }}
            >
              <X className="h-4 w-4 mr-1" />
              重置
            </Button>
          )}
        </div>

        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive whitespace-pre-wrap">
            {error}
          </div>
        )}
        {toastMsg && (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
            {toastMsg}
          </div>
        )}
        {uploading && (
          <div className="rounded-md border bg-muted/40 px-3 py-2 space-y-1.5">
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span className="truncate">{uploadLabel || '上传中…'}</span>
              <span className="font-mono shrink-0">{uploadProgress}%</span>
            </div>
            <Progress value={uploadProgress} className="h-1.5" />
          </div>
        )}

        <div ref={scrollRootRef} className="relative flex-1 overflow-auto rounded-lg border bg-card/30 p-3">
          {dragOver && (
            <div className="pointer-events-none absolute inset-2 z-20 flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-primary/60 bg-background/80 backdrop-blur-sm">
              <Upload className="h-8 w-8 text-primary mb-2" />
              <p className="text-sm font-medium">松开以上传素材</p>
              <p className="text-xs text-muted-foreground mt-1">支持图片 / 视频 / 音频</p>
            </div>
          )}
          {items.length === 0 && !loading ? (
            <div className="flex h-full min-h-[240px] flex-col items-center justify-center text-muted-foreground gap-2">
              <ImageIcon className="h-10 w-10 opacity-30" />
              <p className="text-sm">还没有素材</p>
              <p className="text-xs opacity-70 text-center max-w-sm">
                拖拽文件到此处，或 ⌘V 粘贴剪贴板图片，或点右上角「上传」
              </p>
              <Button size="sm" variant="secondary" className="mt-2" onClick={openFilePicker} disabled={uploading}>
                <Upload className="h-4 w-4 mr-1.5" />
                选择文件
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3">
              {items.map((asset) => {
                const url = previewUrl(asset)
                const cardCopied = copiedCardId === asset.id
                const toolbarPinned = cardCopied
                return (
                  <div
                    key={asset.id}
                    className="group relative overflow-hidden rounded-lg border bg-background text-left transition hover:border-primary/40 hover:shadow-sm"
                  >
                    <button
                      type="button"
                      onClick={() => setSelected(asset)}
                      className="w-full text-left"
                    >
                      <div className="aspect-square bg-muted/40 flex items-center justify-center overflow-hidden relative">
                        {url && asset.mediaKind === 'image' ? (
                          <img src={url} alt={asset.filename} className="h-full w-full object-cover" loading="lazy" />
                        ) : (
                          <KindIcon kind={asset.mediaKind} />
                        )}
                        <EmbedStatusBadge info={embedStatusMap[asset.id]} />
                      </div>
                      <div className="p-2 space-y-1">
                        <div className="flex items-start gap-1">
                          <p className="flex-1 truncate text-xs font-medium">{asset.filename}</p>
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={(e) => {
                              e.stopPropagation()
                              void toggleFavorite(asset)
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.stopPropagation()
                                void toggleFavorite(asset)
                              }
                            }}
                            className="shrink-0"
                          >
                            <Star
                              className={clsx(
                                'h-3.5 w-3.5',
                                asset.favorite ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground opacity-40 group-hover:opacity-80'
                              )}
                            />
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          <Badge variant="outline" className="text-[10px] px-1 py-0">
                            {asset.mediaKind}
                          </Badge>
                          {asset.tags.slice(0, 2).map((t) => (
                            <Badge key={t.id} variant="secondary" className="text-[10px] px-1 py-0">
                              {t.name}
                            </Badge>
                          ))}
                        </div>
                        {asset.createdAt > 0 && (
                          <p
                            className="text-[10px] text-muted-foreground tabular-nums truncate"
                            title={formatTime(asset.createdAt)}
                          >
                            {formatCardTime(asset.createdAt)}
                          </p>
                        )}
                      </div>
                    </button>

                    {/* 悬停工具条：图标胶囊，不拦截打开详情 */}
                    <div
                      className={clsx(
                        'absolute right-2 top-2 z-10 transition-opacity duration-150',
                        toolbarPinned
                          ? 'opacity-100'
                          : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto',
                      )}
                      onClick={(e) => e.stopPropagation()}
                      onPointerDown={(e) => e.stopPropagation()}
                    >
                      <div className="inline-flex items-center gap-0.5 rounded-full border border-border/80 bg-background/95 p-0.5 shadow-md backdrop-blur-sm">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 rounded-full"
                              disabled={!assetCopyUrl(asset)}
                              onClick={() => void copyAsset(asset)}
                              aria-label={cardCopied ? '已复制' : '复制 URL'}
                            >
                              {cardCopied ? (
                                <Check className="!size-3.5 text-emerald-500" />
                              ) : (
                                <Copy className="!size-3.5" />
                              )}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" className="text-xs px-2 py-1">
                            {cardCopied ? '已复制' : '复制 URL'}
                          </TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 rounded-full text-destructive hover:text-destructive hover:bg-destructive/10"
                              disabled={deleting}
                              onClick={() => requestDelete(asset)}
                              aria-label="删除"
                            >
                              <Trash2 className="!size-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" className="text-xs px-2 py-1">
                            删除
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
            {!(semanticMode && q.trim()) && (hasMore || loadingMore) && (
              <div
                ref={loadMoreSentinelRef}
                className="flex items-center justify-center gap-2 py-4 text-xs text-muted-foreground"
              >
                {loadingMore ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    加载更多…
                  </>
                ) : (
                  <span>下拉加载更多</span>
                )}
              </div>
            )}
            {!hasMore && items.length > 0 && !(semanticMode && q.trim()) && (
              <p className="py-3 text-center text-[11px] text-muted-foreground">
                已显示全部 {total} 项
              </p>
            )}
          )}
        </div>

        <Dialog
          open={!!selected}
          onOpenChange={(open) => {
            if (!open) {
              if (deleting || pendingDelete) return
              setSelected(null)
              setCopied(false)
            }
          }}
        >
          <DialogContent className="max-w-3xl max-h-[85vh] overflow-auto">
            {selected && (
              <div className="space-y-4 pr-6">
                <div>
                  <h2 className="text-lg font-semibold break-all">{selected.filename}</h2>
                  <p className="text-xs text-muted-foreground mt-1 font-mono">{selected.id}</p>
                </div>

                <div className="rounded-lg border bg-muted/30 overflow-hidden flex items-center justify-center min-h-[200px]">
                  {previewUrl(selected) && selected.mediaKind === 'image' ? (
                    <img src={previewUrl(selected)!} alt={selected.filename} className="max-h-[420px] object-contain" />
                  ) : previewUrl(selected) && selected.mediaKind === 'video' ? (
                    <video src={previewUrl(selected)!} controls className="max-h-[420px] w-full" />
                  ) : (
                    <KindIcon kind={selected.mediaKind} />
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="text-muted-foreground">来源</span>
                    <p>{selected.source}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">大小</span>
                    <p>{formatBytes(selected.fileSize) || '—'}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">尺寸</span>
                    <p>
                      {selected.width && selected.height
                        ? `${selected.width} × ${selected.height}`
                        : '—'}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">入库时间</span>
                    <p>{formatTime(selected.createdAt)}</p>
                  </div>
                </div>

                {selected.cdnUrl && (
                  <div className="text-sm space-y-1.5">
                    <span className="text-muted-foreground">图床 URL</span>
                    <div className="flex items-start gap-2">
                      <input
                        readOnly
                        value={selected.cdnUrl}
                        onFocus={(e) => e.currentTarget.select()}
                        onClick={(e) => e.currentTarget.select()}
                        className="flex-1 min-w-0 rounded-md border bg-background px-2.5 py-1.5 font-mono text-xs outline-none focus:ring-2 focus:ring-ring"
                      />
                      <Button
                        variant="secondary"
                        size="sm"
                        className="shrink-0"
                        onClick={() => void copyUrl(selected.cdnUrl!)}
                      >
                        {copied ? (
                          <Check className="h-4 w-4 mr-1.5 text-emerald-500" />
                        ) : (
                          <Copy className="h-4 w-4 mr-1.5" />
                        )}
                        {copied ? '已复制' : '复制'}
                      </Button>
                    </div>
                  </div>
                )}

                {selected.prompt && (
                  <div className="text-sm">
                    <span className="text-muted-foreground">提示词</span>
                    <p className="mt-0.5 whitespace-pre-wrap rounded-md border bg-background p-2 text-xs">
                      {selected.prompt}
                    </p>
                  </div>
                )}

                {selected.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {selected.tags.map((t) => (
                      <Badge key={t.id} variant="secondary">
                        {t.kind !== 'general' ? `${t.kind}:` : ''}
                        {t.name}
                      </Badge>
                    ))}
                  </div>
                )}

                <div className="rounded-lg border bg-muted/20 p-3 space-y-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">语义索引</span>
                    <Badge
                      variant="outline"
                      className={clsx(
                        'text-[10px]',
                        detailEmbed?.status === 'ok' && 'border-emerald-500/40 text-emerald-700 dark:text-emerald-400',
                        detailEmbed?.status === 'error' && 'border-destructive/40 text-destructive',
                      )}
                    >
                      {embedStatusLabel(detailEmbed?.status, detailEmbed?.queued)}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                    <div>
                      <span className="block opacity-70">模型</span>
                      <span className="text-foreground font-mono">{detailEmbed?.model || '—'}</span>
                    </div>
                    <div>
                      <span className="block opacity-70">索引时间</span>
                      <span className="text-foreground">
                        {detailEmbed?.indexedAt ? formatTime(detailEmbed.indexedAt) : '—'}
                      </span>
                    </div>
                    {detailEmbed?.dims ? (
                      <div>
                        <span className="block opacity-70">维度</span>
                        <span className="text-foreground">{detailEmbed.dims}</span>
                      </div>
                    ) : null}
                  </div>
                  {detailEmbed?.status === 'error' && detailEmbed.errorMsg && (
                    <p className="text-xs text-destructive whitespace-pre-wrap">{detailEmbed.errorMsg}</p>
                  )}
                  <div className="pt-1 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground text-xs">AI 描述</span>
                      {selected.mediaKind === 'image' && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          disabled={captionGenerating}
                          onClick={() => void generateCaption()}
                        >
                          {captionGenerating ? (
                            <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                          ) : (
                            <Sparkles className="h-3.5 w-3.5 mr-1" />
                          )}
                          {captionGenerating || detailEmbed?.captionStatus === 'running'
                            ? '生成中…'
                            : detailEmbed?.caption || selected.caption
                              ? '重新生成'
                              : '生成描述'}
                        </Button>
                      )}
                    </div>
                    {captionGenerating || detailEmbed?.captionStatus === 'running' ? (
                      <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        正在生成描述，可继续浏览…
                      </p>
                    ) : null}
                    {detailEmbed?.captionStatus === 'error' && detailEmbed.captionError ? (
                      <p className="text-xs text-destructive whitespace-pre-wrap">{detailEmbed.captionError}</p>
                    ) : null}
                    {(detailEmbed?.caption || selected.caption) ? (
                      <p className="text-xs whitespace-pre-wrap rounded-md border bg-background p-2">
                        {detailEmbed?.caption || selected.caption}
                      </p>
                    ) : !(captionGenerating || detailEmbed?.captionStatus === 'running') ? (
                      <p className="text-xs text-muted-foreground">
                        暂无描述。可用 Ollama 视觉模型（默认 qwen3-vl:8b）生成；自动标签见上方 tags。
                      </p>
                    ) : null}
                  </div>
                </div>

                {error && (
                  <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive whitespace-pre-wrap">
                    {error}
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => void toggleFavorite(selected)}>
                    <Star className={clsx('h-4 w-4 mr-1.5', selected.favorite && 'fill-amber-400 text-amber-400')} />
                    {selected.favorite ? '取消收藏' : '收藏'}
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={deleting}
                    onClick={() => requestDelete(selected)}
                  >
                    <Trash2 className="h-4 w-4 mr-1.5" />
                    删除
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        <AlertDialog
          open={!!pendingDelete}
          onOpenChange={(open) => {
            if (!open && !deleting) setPendingDelete(null)
          }}
        >
          <AlertDialogContent className="max-w-md">
            <AlertDialogHeader>
              <AlertDialogTitle>删除素材</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-2 text-sm text-muted-foreground">
                  <p>
                    确定删除「
                    <span className="font-medium text-foreground break-all">
                      {pendingDelete?.filename}
                    </span>
                    」？
                  </p>
                  <p>
                    {pendingHasCloud
                      ? '将同时删除云端对象与本地记录，此操作不可撤销。'
                      : '将删除本地记录，此操作不可撤销。'}
                  </p>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
              <button
                type="button"
                disabled={deleting}
                className={clsx(
                  buttonVariants({ variant: 'destructive' }),
                  'mt-2 sm:mt-0',
                )}
                onClick={() => void confirmDelete()}
              >
                <Trash2 className="h-4 w-4" />
                {deleting ? '删除中…' : '删除'}
              </button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <Dialog open={embedCfgOpen} onOpenChange={setEmbedCfgOpen}>
          <DialogContent className="max-w-md">
            <div className="space-y-4">
              <div>
                <h2 className="text-base font-semibold">智能</h2>
                <p className="text-xs text-muted-foreground mt-1">
                  本地语义索引与自动打标。普通人搜图用顶部「语义」即可；索引与模型配置在此。
                </p>
              </div>

              <div className="rounded-lg border bg-muted/30 p-3 space-y-2.5">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="font-medium">索引进度</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {embedStats
                      ? `${embedStats.indexed}/${embedStats.totalAssets}`
                      : '—'}
                  </span>
                </div>
                {embedStats && embedStats.totalAssets > 0 ? (
                  <Progress
                    value={Math.min(100, Math.round((embedStats.indexed / embedStats.totalAssets) * 100))}
                    className="h-1.5"
                  />
                ) : null}
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                  {embedStats?.queued ? <span>排队 {embedStats.queued}</span> : null}
                  {embedStats?.errors ? <span className="text-destructive">失败 {embedStats.errors}</span> : null}
                  {embedStats?.model ? <span className="font-mono truncate max-w-[180px]">{embedStats.model}</span> : null}
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    className="flex-1"
                    onClick={() => void runIndexBatch()}
                    disabled={indexing}
                  >
                    {indexing ? (
                      <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                    ) : (
                      <Brain className="h-4 w-4 mr-1.5" />
                    )}
                    {indexing ? '索引中…' : '开始索引'}
                  </Button>
                  {indexing ? (
                    <Button size="sm" variant="outline" onClick={() => void stopIndexing()}>
                      停止
                    </Button>
                  ) : null}
                </div>
                {indexing ? (
                  <p className="text-[10px] text-muted-foreground">后台运行中，界面可正常操作；进度会自动刷新。</p>
                ) : null}
              </div>

              {embedCfg && (
                <div className="space-y-3 text-sm">
                  <div className="text-xs font-medium text-muted-foreground">Ollama 配置</div>
                  <label className="flex items-center justify-between gap-3">
                    <span>启用语义索引</span>
                    <input
                      type="checkbox"
                      checked={embedCfg.enabled}
                      onChange={(e) => setEmbedCfg({ ...embedCfg, enabled: e.target.checked })}
                    />
                  </label>
                  <label className="flex items-center justify-between gap-3">
                    <span>近邻自动打标</span>
                    <input
                      type="checkbox"
                      checked={embedCfg.autoTag}
                      onChange={(e) => setEmbedCfg({ ...embedCfg, autoTag: e.target.checked })}
                    />
                  </label>
                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground">Ollama Base URL</div>
                    <input
                      className="w-full h-9 rounded-md border bg-background px-3 text-sm"
                      value={embedCfg.ollamaBaseUrl}
                      onChange={(e) => setEmbedCfg({ ...embedCfg, ollamaBaseUrl: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground">嵌入模型</div>
                    <input
                      className="w-full h-9 rounded-md border bg-background px-3 text-sm"
                      value={embedCfg.model}
                      onChange={(e) => setEmbedCfg({ ...embedCfg, model: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground">描述模型（Ollama VLM）</div>
                    <input
                      className="w-full h-9 rounded-md border bg-background px-3 text-sm"
                      value={embedCfg.captionModel}
                      placeholder="qwen3-vl:8b"
                      onChange={(e) => setEmbedCfg({ ...embedCfg, captionModel: e.target.value })}
                    />
                    <p className="text-[10px] text-muted-foreground">详情页「生成描述」使用此模型；需本机已 pull。</p>
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    <Button size="sm" variant="outline" onClick={() => void testEmbed()}>
                      测试连接
                    </Button>
                    <div className="flex-1" />
                    <Button size="sm" variant="ghost" onClick={() => setEmbedCfgOpen(false)}>
                      取消
                    </Button>
                    <Button size="sm" onClick={() => void saveEmbedCfg()} disabled={embedCfgSaving}>
                      {embedCfgSaving ? '保存中…' : '保存'}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>

      </div>
    </TooltipProvider>
  )
}
