/**
 * 剪贴板历史工具组件
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { flushSync } from 'react-dom'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import {
    Copy, Check, Trash2, Search, Clock, Image, Code, Type,
    Palette, FileText, RefreshCw, MoreVertical, X, Loader2
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from '@/components/ui/alert-dialog'

const imageDataUrlCache = new Map<string, string>()

// 类型定义
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

// 获取类型图标
function getTypeIcon(type: ClipboardItemType) {
    switch (type) {
        case 'image': return <Image className="h-4 w-4" />
        case 'code': return <Code className="h-4 w-4" />
        case 'color': return <Palette className="h-4 w-4" />
        case 'html': return <FileText className="h-4 w-4" />
        default: return <Type className="h-4 w-4" />
    }
}

// 获取类型标签颜色
function getTypeBadgeVariant(type: ClipboardItemType): 'default' | 'secondary' | 'destructive' | 'outline' {
    switch (type) {
        case 'code': return 'default'
        case 'color': return 'destructive'
        case 'image': return 'secondary'
        default: return 'outline'
    }
}

// 格式化时间
function formatTime(timestamp: number): string {
    const now = Date.now()
    const diff = now - timestamp

    if (diff < 60000) return '刚刚'
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`

    const date = new Date(timestamp)
    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// 通过 Rust 命令读取本地图片并转 base64 显示，绕开 WebView file:// 限制
function ClipboardImage({ imagePath }: { imagePath: string }) {
    const [src, setSrc] = useState<string>('')
    const placeholderRef = useRef<HTMLDivElement | null>(null)

    useEffect(() => {
        if (imageDataUrlCache.has(imagePath)) {
            setSrc(imageDataUrlCache.get(imagePath) || '')
            return
        }

        const element = placeholderRef.current
        if (!element) return

        let cancelled = false
        const observer = new IntersectionObserver(
            (entries) => {
                if (!entries[0].isIntersecting) return
                observer.disconnect()
                invoke<string>('clipboard_get_image_data', { imagePath })
                    .then((dataUrl) => {
                        if (cancelled) return
                        imageDataUrlCache.set(imagePath, dataUrl)
                        setSrc(dataUrl)
                    })
                    .catch(() => {
                        if (!cancelled) setSrc('')
                    })
            },
            { rootMargin: '200px' }
        )

        observer.observe(element)

        return () => {
            cancelled = true
            observer.disconnect()
        }
    }, [imagePath])

    if (!src) {
        return <div ref={placeholderRef} className="w-full h-24 rounded-lg bg-zinc-100 dark:bg-zinc-800 animate-pulse" />
    }

    return (
        <img
            src={src}
            alt="Clipboard image"
            className="w-full h-auto max-h-48 object-contain rounded-lg bg-zinc-100 dark:bg-zinc-800"
            loading="lazy"
        />
    )
}

// 代码语法高亮（简化版）
function CodeHighlight({ code, language }: { code: string; language?: string }) {
    // 简单的关键词高亮
    const keywords = {
        javascript: ['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'class', 'import', 'export', 'from', 'async', 'await'],
        python: ['def', 'class', 'import', 'from', 'return', 'if', 'else', 'for', 'while', 'try', 'except', 'with', 'as', 'async', 'await'],
        typescript: ['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'class', 'import', 'export', 'from', 'interface', 'type'],
    }

    const langKeywords = keywords[language as keyof typeof keywords] || []

    let highlighted = code
    langKeywords.forEach(kw => {
        const regex = new RegExp(`\\b(${kw})\\b`, 'g')
        highlighted = highlighted.replace(regex, `<span class="text-blue-500 font-medium">$1</span>`)
    })

    // 高亮字符串
    highlighted = highlighted.replace(/(['"`])([^'"`\n]*?)\1/g, '<span class="text-green-500">$&</span>')
    // 高亮注释
    highlighted = highlighted.replace(/(\/\/.*$|#.*$)/gm, '<span class="text-gray-500 italic">$1</span>')
    // 高亮数字
    highlighted = highlighted.replace(/\b(\d+\.?\d*)\b/g, '<span class="text-orange-500">$1</span>')

    return (
        <pre className="text-xs font-mono bg-zinc-900 text-zinc-100 p-3 rounded-lg overflow-x-auto max-h-40 whitespace-pre-wrap break-all">
            <code dangerouslySetInnerHTML={{ __html: highlighted }} />
        </pre>
    )
}

// 颜色卡片
function ColorCard({ colorValue }: { colorValue: string }) {
    return (
        <div className="flex items-center gap-3 p-3 bg-zinc-100 dark:bg-zinc-800 rounded-lg">
            <div
                className="w-12 h-12 rounded-lg border-2 border-white shadow-md"
                style={{ backgroundColor: colorValue }}
            />
            <div className="font-mono text-sm font-medium">{colorValue}</div>
        </div>
    )
}

// 单个剪贴板条目卡片
function ClipboardCard({
    item,
    onCopy,
    onDelete,
    copied,
    copying
}: {
    item: ClipboardItem
    onCopy: (id: string) => void
    onDelete: (id: string) => void
    copied: boolean
    copying: boolean
}) {
    return (
        <div
            className="group relative bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 hover:shadow-lg hover:border-blue-500/50 transition-all cursor-pointer"
            onClick={() => onCopy(item.id)}
        >
            {/* 头部信息 */}
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <Badge variant={getTypeBadgeVariant(item.type)} className="text-xs">
                        {getTypeIcon(item.type)}
                        <span className="ml-1">{item.type}</span>
                        {item.language && <span className="ml-1 opacity-70">• {item.language}</span>}
                    </Badge>
                </div>

                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={e => e.stopPropagation()}>
                                <MoreVertical className="h-4 w-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onDelete(item.id) }} className="text-red-500">
                                <Trash2 className="h-4 w-4 mr-2" />
                                删除
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </div>

            {/* 内容区域 */}
            <div className="mb-3">
                {item.type === 'image' && item.imagePath && (
                    <div className="relative">
                        <ClipboardImage imagePath={item.imagePath} />
                    </div>
                )}

                {item.type === 'color' && item.colorValue && (
                    <ColorCard colorValue={item.colorValue} />
                )}

                {item.type === 'code' && (
                    <CodeHighlight code={item.content.slice(0, 500)} language={item.language} />
                )}

                {(item.type === 'text' || item.type === 'html') && (
                    <p className="text-sm text-zinc-700 dark:text-zinc-300 line-clamp-4 whitespace-pre-wrap break-words">
                        {item.preview}
                    </p>
                )}
            </div>

            {/* 底部信息 */}
            <div className="flex items-center justify-between text-xs text-zinc-500">
                <div className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {formatTime(item.timestamp)}
                </div>
                <div className="truncate max-w-[120px]" title={item.sourceApp}>
                    {item.sourceApp}
                </div>
            </div>

            {/* 复制中 / 复制成功提示 */}
            {copying && (
                <div className="absolute inset-0 flex items-center justify-center bg-zinc-800/80 rounded-xl text-white font-medium">
                    <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                    复制中…
                </div>
            )}
            {!copying && copied && (
                <div className="absolute inset-0 flex items-center justify-center bg-green-500/90 rounded-xl text-white font-medium">
                    <Check className="h-5 w-5 mr-2" />
                    已复制
                </div>
            )}
        </div>
    )
}

export function ClipboardHistoryPage() {
    const [items, setItems] = useState<ClipboardItem[]>([])
    const [loading, setLoading] = useState(true)
    const [searchQuery, setSearchQuery] = useState('')
    const [copiedId, setCopiedId] = useState<string | null>(null)
    const [copyingId, setCopyingId] = useState<string | null>(null)
    const [stats, setStats] = useState<{ total: number; byType: Record<string, number> } | null>(null)
    const [hasMore, setHasMore] = useState(true)
    const loadMoreRef = useRef<HTMLDivElement>(null)
    const itemsPerPage = 30

    // 加载数据
    const loadItems = useCallback(async (reset = false) => {
        try {
            setLoading(true)
            const offset = reset ? 0 : items.length

            let newItems: ClipboardItem[]
            if (searchQuery.trim()) {
                newItems = await window.api.clipboard.searchItems(searchQuery, itemsPerPage)
                setHasMore(false) // 搜索不支持分页
            } else {
                newItems = await window.api.clipboard.getItems(itemsPerPage, offset)
                setHasMore(newItems.length === itemsPerPage)
            }

            if (reset) {
                setItems(newItems)
            } else {
                setItems(prev => [...prev, ...newItems])
            }
        } catch (error) {
            console.error('Failed to load clipboard items:', error)
        } finally {
            setLoading(false)
        }
    }, [searchQuery, items.length])

    // 加载统计
    const loadStats = useCallback(async () => {
        try {
            const s = await window.api.clipboard.getStats()
            setStats(s)
        } catch (error) {
            console.error('Failed to load stats:', error)
        }
    }, [])

    // 初始加载
    useEffect(() => {
        loadItems(true)
        loadStats()
    }, [])

    // 监听新条目事件，自动刷新
    useEffect(() => {
        let cancelled = false
        let unlisten: (() => void) | null = null

        listen<ClipboardItem>('clipboard:newItem', (event) => {
            if (cancelled) return
            setItems(prev => [event.payload, ...prev])
            loadStats()
        }).then(fn => {
            if (cancelled) {
                fn() // 组件已卸载，立即解绑
            } else {
                unlisten = fn
            }
        })

        return () => {
            cancelled = true
            if (unlisten) unlisten()
        }
    }, [loadStats])

    // 搜索防抖
    useEffect(() => {
        const timer = setTimeout(() => {
            loadItems(true)
        }, 300)
        return () => clearTimeout(timer)
    }, [searchQuery])

    // 无限滚动
    useEffect(() => {
        const observer = new IntersectionObserver(
            entries => {
                if (entries[0].isIntersecting && hasMore && !loading && !searchQuery) {
                    loadItems(false)
                }
            },
            { threshold: 0.1 }
        )

        if (loadMoreRef.current) {
            observer.observe(loadMoreRef.current)
        }

        return () => observer.disconnect()
    }, [hasMore, loading, searchQuery])

    // 复制操作
    const handleCopy = async (id: string) => {
        // flushSync ensures the "copying" spinner renders immediately before the await
        flushSync(() => {
            setCopyingId(id)
            setCopiedId(null)
        })

        try {
            await window.api.clipboard.writeToClipboard(id)
            setCopyingId(null)
            setCopiedId(id)
            setTimeout(() => setCopiedId(prev => prev === id ? null : prev), 1500)
        } catch (error) {
            setCopyingId(null)
            console.error('Failed to copy:', error)
        }
    }

    // 删除操作
    const handleDelete = async (id: string) => {
        try {
            await window.api.clipboard.deleteItem(id)
            setItems(prev => prev.filter(item => item.id !== id))
            loadStats()
        } catch (error) {
            console.error('Failed to delete:', error)
        }
    }

    // 清空所有
    const handleClearAll = async () => {
        try {
            await window.api.clipboard.clearAll()
            setItems([])
            loadStats()
        } catch (error) {
            console.error('Failed to clear all:', error)
        }
    }

    // 刷新
    const handleRefresh = () => {
        loadItems(true)
        loadStats()
    }

    return (
        <div className="h-full flex flex-col">
            {/* 头部 */}
            <div className="flex-shrink-0 pb-4 border-b border-zinc-200 dark:border-zinc-800">
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h2 className="text-xl font-semibold">剪贴板历史</h2>
                        <p className="text-sm text-zinc-500">
                            {stats ? `共 ${stats.total} 条记录` : '加载中...'}
                        </p>
                    </div>

                    <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" onClick={handleRefresh}>
                            <RefreshCw className="h-4 w-4 mr-1" />
                            刷新
                        </Button>

                        <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <Button variant="outline" size="sm" className="text-red-500 hover:text-red-600">
                                    <Trash2 className="h-4 w-4 mr-1" />
                                    清空
                                </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle>确认清空所有记录？</AlertDialogTitle>
                                    <AlertDialogDescription>
                                        此操作不可撤销。所有剪贴板历史记录将被永久删除。
                                    </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>取消</AlertDialogCancel>
                                    <AlertDialogAction onClick={handleClearAll} className="bg-red-500 hover:bg-red-600">
                                        确认清空
                                    </AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                    </div>
                </div>

                {/* 搜索框 */}
                <div className="relative">
                    <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                        <Search className="h-4 w-4 text-zinc-400" />
                    </span>
                    <Input
                        placeholder="搜索剪贴板内容..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-10 pr-10"
                    />
                    {searchQuery && (
                        <Button
                            variant="ghost"
                            size="icon"
                            className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                            onClick={() => setSearchQuery('')}
                        >
                            <X className="h-4 w-4" />
                        </Button>
                    )}
                </div>

                {/* 类型统计 */}
                {stats && Object.keys(stats.byType).length > 0 && (
                    <div className="flex items-center gap-2 mt-3 flex-wrap">
                        {Object.entries(stats.byType).map(([type, count]) => (
                            <Badge key={type} variant="secondary" className="text-xs">
                                {getTypeIcon(type as ClipboardItemType)}
                                <span className="ml-1">{type}: {count}</span>
                            </Badge>
                        ))}
                    </div>
                )}
            </div>

            {/* 内容区域（瀑布流） */}
            <div className="flex-1 overflow-auto py-4">
                {loading && items.length === 0 ? (
                    <div className="flex items-center justify-center h-40 text-zinc-500">
                        <RefreshCw className="h-5 w-5 mr-2 animate-spin" />
                        加载中...
                    </div>
                ) : items.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-40 text-zinc-500">
                        <Copy className="h-10 w-10 mb-3 opacity-30" />
                        <p>暂无剪贴板记录</p>
                        <p className="text-sm mt-1">复制内容后将自动记录</p>
                    </div>
                ) : (
                    <>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 auto-rows-max">
                            {items.map(item => (
                                <div key={item.id}>
                                    <ClipboardCard
                                        item={item}
                                        onCopy={handleCopy}
                                        onDelete={handleDelete}
                                        copied={copiedId === item.id}
                                        copying={copyingId === item.id}
                                    />
                                </div>
                            ))}
                        </div>

                        {/* 加载更多触发器 */}
                        <div ref={loadMoreRef} className="h-10 flex items-center justify-center mt-4">
                            {loading && <RefreshCw className="h-5 w-5 animate-spin text-zinc-400" />}
                            {!hasMore && items.length > 0 && (
                                <span className="text-sm text-zinc-400">已加载全部</span>
                            )}
                        </div>
                    </>
                )}
            </div>
        </div>
    )
}
