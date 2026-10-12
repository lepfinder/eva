import { useCallback, useEffect, useState } from 'react'
import {
  Image as ImageIcon,
  Search,
  Star,
  RefreshCw,
  Upload,
  Film,
  Music,
  File,
  Filter,
  Trash2,
  Copy,
  Check,
} from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent } from '@/components/ui/dialog'
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
  createdAt: number
  updatedAt: number
  tags: MediaTag[]
}

interface AssetListResult {
  items: MediaAsset[]
  total: number
}

function KindIcon({ kind }: { kind: string }) {
  if (kind === 'video') return <Film className="h-8 w-8 opacity-40" />
  if (kind === 'audio') return <Music className="h-8 w-8 opacity-40" />
  if (kind === 'image') return <ImageIcon className="h-8 w-8 opacity-40" />
  return <File className="h-8 w-8 opacity-40" />
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
  const [copied, setCopied] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await invoke<AssetListResult>('media_assets_list', {
        limit: 120,
        offset: 0,
        q: q.trim() || null,
        mediaKind: kind === 'all' ? null : kind,
        favoriteOnly,
        tag: null,
      })
      setItems(res.items)
      setTotal(res.total)
    } catch (e) {
      console.error('[MediaAssets] list failed', e)
      setError(String(e))
      setItems([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [q, kind, favoriteOnly])

  useEffect(() => {
    void load()
  }, [load])

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

  const copyUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch (e) {
      console.error('[MediaAssets] copy failed', e)
      setError('复制失败')
    }
  }

  const deleteAsset = async (asset: MediaAsset) => {
    const hasCloud = !!asset.cdnUrl?.trim()
    const msg = hasCloud
      ? `确定删除「${asset.filename}」？\n将同时删除云端对象与本地记录，此操作不可撤销。`
      : `确定删除「${asset.filename}」？\n将删除本地记录，此操作不可撤销。`
    if (!window.confirm(msg)) return

    setDeleting(true)
    setError(null)
    try {
      await invoke('media_assets_delete', { id: asset.id })
      setItems((prev) => prev.filter((x) => x.id !== asset.id))
      setTotal((t) => Math.max(0, t - 1))
      setSelected(null)
    } catch (e) {
      console.error('[MediaAssets] delete failed', e)
      setError(String(e))
    } finally {
      setDeleting(false)
    }
  }


  const importPiclistGallery = async () => {
    if (importing) return
    setImporting(true)
    setImportMsg(null)
    setError(null)
    try {
      const res = await invoke<{
        total: number
        inserted: number
        updated: number
        skipped: number
        failed: number
        failures: { id?: string; imgUrl?: string; reason: string }[]
      }>('media_assets_import_piclist')
      const failHint =
        res.failed > 0 && res.failures?.length
          ? `；失败例: ${res.failures[0].reason}`
          : ''
      setImportMsg(
        `PicList 相册 ${res.total} 项 → 新增 ${res.inserted} / 更新 ${res.updated} / 跳过 ${res.skipped} / 失败 ${res.failed}${failHint}`,
      )
      await load()
    } catch (e) {
      setError(String(e))
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">素材库</h1>
          <p className="text-sm text-muted-foreground mt-1">
            自用图/音/视频资产 · PicList / 手动入库 · 与视觉回溯分离
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="font-mono text-[11px]">
            {total} 项
          </Badge>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void importPiclistGallery()}
            disabled={importing || loading}
          >
            <Upload className={clsx('h-4 w-4 mr-1.5', importing && 'animate-pulse')} />
            {importing ? '导入中…' : '从 PicList 导入相册'}
          </Button>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={clsx('h-4 w-4 mr-1.5', loading && 'animate-spin')} />
            刷新
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            className="w-full h-9 rounded-md border bg-background pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            placeholder="搜索文件名 / 提示词 / 备注 / 标签"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void load()
            }}
          />
        </div>
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
        >
          <Star className={clsx('h-4 w-4 mr-1.5', favoriteOnly && 'fill-amber-400 text-amber-400')} />
          收藏
        </Button>
        <Button size="sm" variant="ghost" className="h-9" onClick={() => { setQ(''); setKind('all'); setFavoriteOnly(false) }}>
          <Filter className="h-4 w-4 mr-1" />
          重置
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      {importMsg && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
          {importMsg}
        </div>
      )}

      <div className="flex-1 overflow-auto rounded-lg border bg-card/30 p-3">
        {items.length === 0 && !loading ? (
          <div className="flex h-full min-h-[240px] flex-col items-center justify-center text-muted-foreground gap-2">
            <ImageIcon className="h-10 w-10 opacity-30" />
            <p className="text-sm">还没有素材</p>
            <p className="text-xs opacity-70">
              点右上角「从 PicList 导入相册」，或粘贴上传 / <code className="font-mono">POST /api/assets/ingest</code>
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3">
            {items.map((asset) => {
              const url = previewUrl(asset)
              return (
                <button
                  key={asset.id}
                  type="button"
                  onClick={() => setSelected(asset)}
                  className="group relative overflow-hidden rounded-lg border bg-background text-left transition hover:border-primary/40 hover:shadow-sm"
                >
                  <div className="aspect-square bg-muted/40 flex items-center justify-center overflow-hidden">
                    {url && asset.mediaKind === 'image' ? (
                      <img src={url} alt={asset.filename} className="h-full w-full object-cover" loading="lazy" />
                    ) : (
                      <KindIcon kind={asset.mediaKind} />
                    )}
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
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>

      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) {
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

              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => void toggleFavorite(selected)}>
                  <Star className={clsx('h-4 w-4 mr-1.5', selected.favorite && 'fill-amber-400 text-amber-400')} />
                  {selected.favorite ? '取消收藏' : '收藏'}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={deleting}
                  onClick={() => void deleteAsset(selected)}
                >
                  <Trash2 className="h-4 w-4 mr-1.5" />
                  {deleting ? '删除中…' : '删除'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
