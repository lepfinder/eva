import React, { useState, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import {
    ClipboardList,
    Copy,
    Check,
    ChevronRight,
    Code,
    FileText,
    Image,
    Palette,
    Sparkles
} from 'lucide-react'

type ClipboardItemType = 'text' | 'image' | 'html' | 'color' | 'code'

interface ClipboardItem {
    id: string
    type: ClipboardItemType
    content: string
    preview: string
    sourceApp: string
    timestamp: number
    imagePath?: string
    language?: string
    colorValue?: string
}

const imageCache = new Map<string, string>()

function formatRelativeTime(timestamp: number): string {
    const diff = Math.floor((Date.now() - timestamp) / 1000)
    if (diff < 30) return '刚刚'
    if (diff < 60) return `${diff}秒前`
    if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`
    const hours = Math.floor(diff / 3600)
    return `${hours}小时前`
}

// 图片缩略图组件 (直接通过 Rust 获取 base64 预览)
function ClipThumbnail({ imagePath }: { imagePath: string }) {
    const [dataUrl, setDataUrl] = useState<string>(imageCache.get(imagePath) || '')

    useEffect(() => {
        if (!imagePath) return
        if (imageCache.has(imagePath)) {
            setDataUrl(imageCache.get(imagePath)!)
            return
        }

        let isCancelled = false
        invoke<string>('clipboard_get_image_data', { imagePath })
            .then((res) => {
                if (!isCancelled && res) {
                    imageCache.set(imagePath, res)
                    setDataUrl(res)
                }
            })
            .catch(() => {})

        return () => {
            isCancelled = true
        }
    }, [imagePath])

    if (!dataUrl) {
        return (
            <div className="w-12 h-10 rounded-lg bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center shrink-0 border border-zinc-200/60 dark:border-zinc-700/60">
                <Image className="h-4 w-4 text-zinc-400 animate-pulse" />
            </div>
        )
    }

    return (
        <div className="w-12 h-10 rounded-lg overflow-hidden shrink-0 border border-zinc-200/80 dark:border-zinc-700/80 bg-zinc-50 dark:bg-zinc-900 shadow-2xs">
            <img src={dataUrl} alt="剪贴图片预览" className="w-full h-full object-cover" />
        </div>
    )
}

export function QuickClipsCard(): React.ReactElement {
    const [items, setItems] = useState<ClipboardItem[]>([])
    const [copiedId, setCopiedId] = useState<string | null>(null)
    const [loading, setLoading] = useState(true)

    const loadRecentItems = useCallback(async () => {
        try {
            if (window.api?.clipboard?.getItems) {
                const list = await window.api.clipboard.getItems(2, 0)
                setItems(list || [])
            }
        } catch (e) {
            console.warn('Failed to fetch recent clipboard items:', e)
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        loadRecentItems()

        // 监听剪贴板更新事件，实时响应
        let unlisten: (() => void) | undefined
        listen('clipboard-updated', () => {
            loadRecentItems()
        }).then(fn => {
            unlisten = fn
        }).catch(() => {})

        return () => {
            if (unlisten) unlisten()
        }
    }, [loadRecentItems])

    const handleCopy = async (e: React.MouseEvent, item: ClipboardItem) => {
        e.stopPropagation()
        try {
            if (window.api?.clipboard?.writeToClipboard) {
                await window.api.clipboard.writeToClipboard(item.id)
            } else {
                await navigator.clipboard.writeText(item.content)
            }
            setCopiedId(item.id)
            setTimeout(() => setCopiedId(null), 1500)
        } catch (err) {
            console.error('Failed to write clipboard:', err)
        }
    }

    const handleOpenClipboard = () => {
        window.dispatchEvent(new CustomEvent('navigate-to-page', {
            detail: { page: 'clipboard' }
        }))
    }

    return (
        <div className="space-y-2 select-none">
            {/* 顶部标题栏 */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                    <ClipboardList className="h-3.5 w-3.5 text-blue-500" />
                    <span>最近剪贴暂存</span>
                </div>

                <button
                    onClick={handleOpenClipboard}
                    className="flex items-center gap-0.5 text-xs text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                >
                    <span>完整历史</span>
                    <ChevronRight className="h-3 w-3" />
                </button>
            </div>

            {/* 条目列表 */}
            {loading ? (
                <div className="h-16 flex items-center justify-center text-xs text-zinc-400">
                    <Sparkles className="h-3.5 w-3.5 animate-spin mr-1.5 text-blue-400" />
                    <span>加载剪贴记录...</span>
                </div>
            ) : items.length === 0 ? (
                <div className="py-3 text-center text-xs text-zinc-400">
                    暂无最近剪贴内容，复制文本或代码后将在此暂存
                </div>
            ) : (
                <div className="space-y-2 pt-0.5">
                    {items.map((item) => {
                        const isCopied = copiedId === item.id
                        const isImage = item.type === 'image' && item.imagePath
                        const isColor = item.type === 'color' && item.colorValue
                        const isCode = item.type === 'code'

                        // 预览文字过滤
                        const rawText = item.preview?.trim() || item.content?.trim() || ''
                        const hasOcrText = isImage && rawText && !rawText.includes('.png') && !rawText.includes('.jpg')

                        return (
                            <div
                                key={item.id}
                                onClick={(e) => handleCopy(e, item)}
                                className="group/item flex items-start justify-between p-2.5 rounded-xl bg-white/50 dark:bg-zinc-800/40 border border-white/60 dark:border-white/5 hover:bg-white/85 dark:hover:bg-zinc-800/80 hover:border-blue-200/90 dark:hover:border-blue-800/60 transition-all duration-200 cursor-pointer shadow-2xs gap-3"
                                title="点击直接写回系统剪贴板"
                            >
                                {/* 左侧：真实图片缩略图 或 类型图标/色块 */}
                                {isImage ? (
                                    <ClipThumbnail imagePath={item.imagePath!} />
                                ) : isColor ? (
                                    <div 
                                        className="w-10 h-10 rounded-lg shrink-0 border border-black/10 dark:border-white/10 shadow-inner flex items-center justify-center"
                                        style={{ backgroundColor: item.colorValue }}
                                    >
                                        <Palette className="h-3.5 w-3.5 text-white drop-shadow-md" />
                                    </div>
                                ) : (
                                    <div className="w-8 h-8 rounded-lg bg-zinc-100/90 dark:bg-zinc-700/60 flex items-center justify-center shrink-0 mt-0.5 border border-zinc-200/50 dark:border-zinc-700/50">
                                        {isCode ? (
                                            <Code className="h-4 w-4 text-violet-500" />
                                        ) : (
                                            <FileText className="h-4 w-4 text-zinc-400" />
                                        )}
                                    </div>
                                )}

                                {/* 中间：多行真实内容预览与标签 */}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5 mb-1">
                                        {isCode && item.language && (
                                            <span className="text-[10px] font-mono uppercase px-1 py-0.2 rounded bg-violet-100 dark:bg-violet-950/60 text-violet-600 dark:text-violet-400 font-semibold">
                                                {item.language}
                                            </span>
                                        )}
                                        <span className="text-[10px] text-zinc-400 truncate max-w-[120px]">
                                            {item.sourceApp || '系统剪贴板'}
                                        </span>
                                        <span className="text-[10px] text-zinc-300 dark:text-zinc-600">·</span>
                                        <span className="text-[10px] text-zinc-400 font-mono">
                                            {formatRelativeTime(item.timestamp)}
                                        </span>
                                    </div>

                                    {/* 2 行多行预览 */}
                                    {isImage ? (
                                        <p className="text-xs text-zinc-600 dark:text-zinc-300 line-clamp-2 leading-relaxed font-normal">
                                            {hasOcrText ? rawText : '截图 / 本地图片（点击快捷复制图片文件）'}
                                        </p>
                                    ) : isColor ? (
                                        <p className="text-xs font-mono font-medium text-zinc-800 dark:text-zinc-200">
                                            {item.colorValue}
                                        </p>
                                    ) : isCode ? (
                                        <p className="text-[11.5px] font-mono text-zinc-700 dark:text-zinc-200 line-clamp-2 leading-relaxed bg-zinc-50/70 dark:bg-zinc-900/50 p-1 rounded border border-zinc-200/40 dark:border-zinc-800/40">
                                            {rawText}
                                        </p>
                                    ) : (
                                        <p className="text-xs text-zinc-700 dark:text-zinc-200 line-clamp-2 leading-relaxed font-normal break-words">
                                            {rawText}
                                        </p>
                                    )}
                                </div>

                                {/* 右侧：快捷操作按钮 */}
                                <div className="shrink-0 self-center">
                                    <button
                                        onClick={(e) => handleCopy(e, item)}
                                        className={`h-7 w-7 rounded-lg flex items-center justify-center transition-all ${isCopied ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600' : 'text-zinc-400 hover:text-blue-600 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/40'}`}
                                        title={isCopied ? "已复制到剪贴板" : "一键复制"}
                                    >
                                        {isCopied ? (
                                            <Check className="h-3.5 w-3.5 text-emerald-500" />
                                        ) : (
                                            <Copy className="h-3.5 w-3.5" />
                                        )}
                                    </button>
                                </div>
                            </div>
                        )
                    })}
                </div>
            )}
        </div>
    )
}
