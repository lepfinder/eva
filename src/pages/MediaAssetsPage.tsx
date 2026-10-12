import { useCallback, useEffect, useState } from 'react'
import {
  Image as ImageIcon,
  Search,
  Star,
  RefreshCw,
  Film,
  Music,
  File,
  Filter,
  Trash2,
  Copy,
  Check,
  CloudUpload,
} from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'
import { Button, buttonVariants } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent } from '@/components/ui/dialog'
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
  const [pendingDelete, setPendingDelete] = useState<MediaAsset | null>(null)
  const [copied, setCopied] = useState(false)
  const [copiedCardId, setCopiedCardId] = useState<string | null>(null)
  const [toastMsg, setToastMsg] = useState<string | null>(null)

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

  const pendingHasCloud = Boolean(pendingDelete?.cdnUrl?.trim())

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full flex-col gap-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">素材库</h1>
            <p className="text-sm text-muted-foreground mt-1">
              自用图/音/视频资产 · 手动入库 · 与视觉回溯分离
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="font-mono text-[11px]">
              {total} 项
            </Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                window.dispatchEvent(
                  new CustomEvent('navigate-to-page', {
                    detail: { page: 'settings', tab: 'cdn' },
                  }),
                )
              }}
            >
              <CloudUpload className="h-4 w-4 mr-1.5" />
              图床配置
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
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive whitespace-pre-wrap">
            {error}
          </div>
        )}
        {toastMsg && (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
            {toastMsg}
          </div>
        )}

        <div className="flex-1 overflow-auto rounded-lg border bg-card/30 p-3">
          {items.length === 0 && !loading ? (
            <div className="flex h-full min-h-[240px] flex-col items-center justify-center text-muted-foreground gap-2">
              <ImageIcon className="h-10 w-10 opacity-30" />
              <p className="text-sm">还没有素材</p>
              <p className="text-xs opacity-70">
                可在「图床配置」中从 PicList 导入相册，或粘贴上传 / <code className="font-mono">POST /api/assets/ingest</code>
              </p>
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
      </div>
    </TooltipProvider>
  )
}
