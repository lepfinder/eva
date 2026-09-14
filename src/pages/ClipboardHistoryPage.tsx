/**
 * 剪贴板历史工具组件
 */
import { useState, useEffect, useCallback, useRef, useMemo, memo } from 'react'
import { invoke, convertFileSrc } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import {
    Copy, Check, Trash2, Search, Clock, Image, Code, Type,
    Palette, FileText, RefreshCw, MoreVertical, X, Loader2,
    Calendar, CalendarDays, PanelLeftClose, PanelLeft,
    Layers, FilterX, ZoomIn
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
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

/** 本地日历日 YYYY-MM-DD（勿用 toISOString，那是 UTC） */
function localDateString(date = new Date()) {
    const pad = (n: number) => n.toString().padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

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
    thumbPath?: string
    language?: string
    colorValue?: string
}

interface DailyStat {
    date: string // YYYY-MM-DD
    count: number
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

// 格式化日期标题与副标题
function formatDateLabel(dateStr: string) {
    const today = new Date()
    const localToday = localDateString(today)

    const yest = new Date()
    yest.setDate(yest.getDate() - 1)
    const localYest = localDateString(yest)

    const beforeYest = new Date()
    beforeYest.setDate(beforeYest.getDate() - 2)
    const localBeforeYest = localDateString(beforeYest)

    const parts = dateStr.split('-')
    const year = parseInt(parts[0], 10)
    const month = parseInt(parts[1], 10)
    const day = parseInt(parts[2], 10)
    const targetDate = new Date(year, month - 1, day)
    const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
    const weekDay = weekDays[targetDate.getDay()]

    if (dateStr === localToday) {
        return { title: '今天', sub: `${month}月${day}日 · ${weekDay}`, isToday: true }
    } else if (dateStr === localYest) {
        return { title: '昨天', sub: `${month}月${day}日 · ${weekDay}`, isToday: false }
    } else if (dateStr === localBeforeYest) {
        return { title: '前天', sub: `${month}月${day}日 · ${weekDay}`, isToday: false }
    } else {
        const isCurrentYear = year === today.getFullYear()
        const title = isCurrentYear ? `${month}月${day}日` : `${year}年${month}月${day}日`
        return { title, sub: weekDay, isToday: false }
    }
}

// 列表优先走 asset protocol（缩略图），失败时再回退 base64；预览可强制原图
function ClipboardImage({
    imagePath,
    thumbPath,
    preferFull = false,
    className,
}: {
    imagePath: string
    thumbPath?: string
    preferFull?: boolean
    className?: string
}) {
    const displayPath = preferFull ? imagePath : (thumbPath || imagePath)
    const assetSrc = convertFileSrc(displayPath)
    const [src, setSrc] = useState(assetSrc)
    const [failedAsset, setFailedAsset] = useState(false)

    useEffect(() => {
        setSrc(convertFileSrc(preferFull ? imagePath : (thumbPath || imagePath)))
        setFailedAsset(false)
    }, [imagePath, thumbPath, preferFull])

    useEffect(() => {
        if (!failedAsset) return
        if (imageDataUrlCache.has(imagePath)) {
            setSrc(imageDataUrlCache.get(imagePath) || '')
            return
        }
        let cancelled = false
        invoke<string>('clipboard_get_image_data', { imagePath })
            .then((dataUrl) => {
                if (cancelled) return
                imageDataUrlCache.set(imagePath, dataUrl)
                setSrc(dataUrl)
            })
            .catch(() => {
                if (!cancelled) setSrc('')
            })
        return () => {
            cancelled = true
        }
    }, [failedAsset, imagePath])

    if (!src) {
        return <div className="w-full h-24 rounded-lg bg-zinc-100 dark:bg-zinc-800 animate-pulse" />
    }

    return (
        <img
            src={src}
            alt="Clipboard image"
            className={
                className ??
                'w-full h-auto max-h-48 object-contain rounded-lg bg-zinc-100 dark:bg-zinc-800'
            }
            loading="lazy"
            onError={() => {
                if (!failedAsset) setFailedAsset(true)
            }}
        />
    )
}

function ImagePreviewDialog({
    item,
    open,
    onOpenChange,
    onCopy,
}: {
    item: ClipboardItem | null
    open: boolean
    onOpenChange: (open: boolean) => void
    onCopy: (id: string) => void
}) {
    if (!item?.imagePath) return null

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-[min(96vw,1100px)] w-full gap-3 overflow-hidden p-4 sm:rounded-xl">
                <DialogHeader className="pr-8 text-left">
                    <DialogTitle className="text-base">图片预览</DialogTitle>
                    <DialogDescription className="text-xs">
                        {formatTime(item.timestamp)}
                        {item.sourceApp ? ` · ${item.sourceApp}` : ''}
                        {' · 原图预览'}
                    </DialogDescription>
                </DialogHeader>
                <div className="flex max-h-[min(78vh,820px)] items-center justify-center overflow-auto rounded-lg bg-zinc-100 dark:bg-zinc-900/80 p-2">
                    <ClipboardImage
                        imagePath={item.imagePath}
                        preferFull
                        className="max-h-[min(76vh,800px)] w-auto max-w-full object-contain"
                    />
                </div>
                <div className="flex justify-end gap-2">
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => onOpenChange(false)}
                    >
                        关闭
                    </Button>
                    <Button
                        type="button"
                        size="sm"
                        onClick={() => {
                            onCopy(item.id)
                            onOpenChange(false)
                        }}
                    >
                        <Copy className="mr-1.5 h-3.5 w-3.5" />
                        复制
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    )
}

// 代码语法高亮（简化版）
function CodeHighlight({ code, language }: { code: string; language?: string }) {
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

    highlighted = highlighted.replace(/(['"`])([^'"`\n]*?)\1/g, '<span class="text-green-500">$&</span>')
    highlighted = highlighted.replace(/(\/\/.*$|#.*$)/gm, '<span class="text-gray-500 italic">$1</span>')
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
const ClipboardCard = memo(function ClipboardCard({
    item,
    onCopy,
    onDelete,
    onPreview,
    copied,
    copying
}: {
    item: ClipboardItem
    onCopy: (id: string) => void
    onDelete: (id: string) => void
    onPreview?: (item: ClipboardItem) => void
    copied: boolean
    copying: boolean
}) {
    return (
        <div
            className={[
                'group relative bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-4',
                'hover:shadow-lg hover:border-blue-500/50 transition-[box-shadow,border-color,transform] duration-150 cursor-pointer',
                '[content-visibility:auto] [contain-intrinsic-size:auto_220px]',
                copying ? 'scale-[0.99] border-blue-500/60' : '',
                copied ? 'border-emerald-500/50' : '',
            ].join(' ')}
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
                    {item.type === 'image' && item.imagePath && onPreview && (
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            title="放大查看"
                            onClick={(e) => {
                                e.stopPropagation()
                                onPreview(item)
                            }}
                        >
                            <ZoomIn className="h-4 w-4" />
                        </Button>
                    )}
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={e => e.stopPropagation()}>
                                <MoreVertical className="h-4 w-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            {item.type === 'image' && item.imagePath && onPreview && (
                                <DropdownMenuItem
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        onPreview(item)
                                    }}
                                >
                                    <ZoomIn className="h-4 w-4 mr-2" />
                                    放大查看
                                </DropdownMenuItem>
                            )}
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
                        <ClipboardImage imagePath={item.imagePath} thumbPath={item.thumbPath} />
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

            {/* 复制中 / 复制成功 — 立即可见的中间态 */}
            {(copying || copied) && (
                <div
                    className={[
                        'absolute inset-0 z-10 flex items-center justify-center rounded-xl text-white font-medium',
                        'animate-in fade-in zoom-in-95 duration-150',
                        copying ? 'bg-zinc-900/75 backdrop-blur-[2px]' : 'bg-emerald-500/90',
                    ].join(' ')}
                >
                    {copying ? (
                        <>
                            <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                            复制中…
                        </>
                    ) : (
                        <>
                            <Check className="h-5 w-5 mr-2" />
                            已复制
                        </>
                    )}
                </div>
            )}
        </div>
    )
})

export function ClipboardHistoryPage() {
    const [items, setItems] = useState<ClipboardItem[]>([])
    const [previewItem, setPreviewItem] = useState<ClipboardItem | null>(null)
    const [loading, setLoading] = useState(true)
    const [searchQuery, setSearchQuery] = useState('')
    const [copiedId, setCopiedId] = useState<string | null>(null)
    const [copyingId, setCopyingId] = useState<string | null>(null)
    const [stats, setStats] = useState<{ total: number; byType: Record<string, number> } | null>(null)
    const [dailyStats, setDailyStats] = useState<DailyStat[]>([])
    const [selectedDate, setSelectedDate] = useState<string | null>(null)
    const [selectedType, setSelectedType] = useState<ClipboardItemType | null>(null)
    const [isSidebarOpen, setIsSidebarOpen] = useState(true)
    const [hasMore, setHasMore] = useState(true)
    const loadMoreRef = useRef<HTMLDivElement>(null)
    const itemsPerPage = 30

    // 加载每日统计
    const loadDailyStats = useCallback(async () => {
        try {
            const data: DailyStat[] = await window.api.clipboard.getDailyStats()
            setDailyStats(data || [])
        } catch (error) {
            console.error('Failed to load daily stats:', error)
        }
    }, [])

    // 加载总体统计
    const loadStats = useCallback(async () => {
        try {
            const s = await window.api.clipboard.getStats()
            setStats(s)
        } catch (error) {
            console.error('Failed to load stats:', error)
        }
    }, [])

    // 加载列表条目数据
    const loadItems = useCallback(async (reset = false, customDate?: string | null) => {
        try {
            setLoading(true)
            const offset = reset ? 0 : items.length
            const activeDate = customDate !== undefined ? customDate : selectedDate

            let newItems: ClipboardItem[]
            if (searchQuery.trim()) {
                newItems = await window.api.clipboard.searchItems(searchQuery, itemsPerPage, activeDate || undefined)
                setHasMore(false) // 搜索结果单次返回
            } else {
                newItems = await window.api.clipboard.getItems(itemsPerPage, offset, activeDate || undefined)
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
    }, [searchQuery, items.length, selectedDate])

    // 初始化加载
    useEffect(() => {
        loadItems(true)
        loadStats()
        loadDailyStats()
    }, [])

    // 监听新条目事件，自动刷新数据与统计
    useEffect(() => {
        let cancelled = false
        let unlisten: (() => void) | null = null

        listen<ClipboardItem>('clipboard:newItem', (event) => {
            if (cancelled) return
            // 如果未限定日期或当前选中的是今天，则 prepend（必须用本地日期，与侧栏/SQL localtime 一致）
            const todayStr = localDateString()
            if (!selectedDate || selectedDate === todayStr) {
                setItems(prev => [event.payload, ...prev])
            }
            loadStats()
            loadDailyStats()
        }).then(fn => {
            if (cancelled) {
                fn()
            } else {
                unlisten = fn
            }
        })

        return () => {
            cancelled = true
            if (unlisten) unlisten()
        }
    }, [loadStats, loadDailyStats, selectedDate])

    // 搜索防抖
    useEffect(() => {
        const timer = setTimeout(() => {
            loadItems(true)
        }, 300)
        return () => clearTimeout(timer)
    }, [searchQuery])

    // 切换日期过滤
    const handleSelectDate = (date: string | null) => {
        setSelectedDate(date)
        setItems([])
        loadItems(true, date)
    }

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
    }, [hasMore, loading, searchQuery, loadItems])

    // 复制操作：先亮「复制中」，再异步写系统剪贴板（不阻塞 UI 线程）
    const handleCopy = useCallback(async (id: string) => {
        setCopyingId(id)
        setCopiedId(null)
        try {
            const ok = await window.api.clipboard.writeToClipboard(id)
            if (!ok) {
                throw new Error('clipboard write returned false')
            }
            setCopyingId(null)
            setCopiedId(id)
            setTimeout(() => setCopiedId(prev => (prev === id ? null : prev)), 1200)
        } catch (error) {
            setCopyingId(null)
            console.error('Failed to copy:', error)
        }
    }, [])

    // 删除操作
    const handleDelete = useCallback(async (id: string) => {
        try {
            await window.api.clipboard.deleteItem(id)
            setItems(prev => prev.filter(item => item.id !== id))
            setPreviewItem(prev => (prev?.id === id ? null : prev))
            void loadStats()
            void loadDailyStats()
        } catch (error) {
            console.error('Failed to delete:', error)
        }
    }, [loadStats, loadDailyStats])

    const handlePreview = useCallback((item: ClipboardItem) => {
        setPreviewItem(item)
    }, [])

    // 清空所有
    const handleClearAll = async () => {
        try {
            await window.api.clipboard.clearAll()
            setItems([])
            setSelectedDate(null)
            loadStats()
            loadDailyStats()
        } catch (error) {
            console.error('Failed to clear all:', error)
        }
    }

    // 刷新
    const handleRefresh = () => {
        loadItems(true)
        loadStats()
        loadDailyStats()
    }

    // 前端类型过滤
    const filteredItems = useMemo(
        () => (selectedType ? items.filter(item => item.type === selectedType) : items),
        [items, selectedType]
    )

    const selectedDateObj = selectedDate ? formatDateLabel(selectedDate) : null

    return (
        <div className="h-full flex flex-row overflow-hidden gap-3">
            {/* 左侧时间索引侧边栏 */}
            <div
                className={`flex-shrink-0 transition-all duration-300 flex flex-col border-r border-zinc-200 dark:border-zinc-800 pr-2 ${
                    isSidebarOpen ? 'w-44' : 'w-10'
                }`}
            >
                {/* 侧边栏头部 */}
                <div className="flex items-center justify-between pb-2.5 mb-2 border-b border-zinc-100 dark:border-zinc-800/80">
                    {isSidebarOpen ? (
                        <div className="flex items-center gap-1.5">
                            <CalendarDays className="h-3.5 w-3.5 text-blue-500" />
                            <span className="text-xs font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                                时间索引
                            </span>
                        </div>
                    ) : (
                        <div className="w-full flex justify-center">
                            <CalendarDays className="h-3.5 w-3.5 text-blue-500" />
                        </div>
                    )}
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                        onClick={() => setIsSidebarOpen(prev => !prev)}
                        title={isSidebarOpen ? '收起索引' : '展开索引'}
                    >
                        {isSidebarOpen ? <PanelLeftClose className="h-3.5 w-3.5" /> : <PanelLeft className="h-3.5 w-3.5" />}
                    </Button>
                </div>

                {/* 日期列表 */}
                <div className="flex-1 overflow-y-auto space-y-0.5 pr-0.5 custom-scrollbar">
                    {/* 全部记录选项 */}
                    <button
                        onClick={() => handleSelectDate(null)}
                        className={`w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-xs transition-all ${
                            selectedDate === null
                                ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 font-medium shadow-sm'
                                : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/60'
                        }`}
                        title={!isSidebarOpen ? `全部记录 (${stats?.total ?? 0})` : undefined}
                    >
                        <div className="flex items-center gap-1.5 truncate">
                            <Layers className="h-3.5 w-3.5 flex-shrink-0" />
                            {isSidebarOpen && <span>全部记录</span>}
                        </div>
                        {isSidebarOpen && stats && (
                            <Badge
                                variant={selectedDate === null ? 'default' : 'secondary'}
                                className={`text-[10px] h-4 px-1 font-normal ${
                                    selectedDate === null ? 'bg-blue-600 text-white' : ''
                                }`}
                            >
                                {stats.total}
                            </Badge>
                        )}
                    </button>

                    {/* 每日日期列表 */}
                    {dailyStats.map((stat) => {
                        const { title, sub, isToday } = formatDateLabel(stat.date)
                        const isSelected = selectedDate === stat.date

                        return (
                            <button
                                key={stat.date}
                                onClick={() => handleSelectDate(stat.date)}
                                className={`w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-xs transition-all ${
                                    isSelected
                                        ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 font-medium shadow-sm'
                                        : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/60'
                                }`}
                                title={!isSidebarOpen ? `${title} (${stat.count}条)` : undefined}
                            >
                                <div className="flex flex-col items-start truncate text-left min-w-0">
                                    <div className="flex items-center gap-1">
                                        <span className={`truncate ${isToday ? 'text-blue-500 font-medium' : ''}`}>
                                            {isSidebarOpen ? title : stat.date.slice(5)}
                                        </span>
                                        {isToday && isSidebarOpen && (
                                            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />
                                        )}
                                    </div>
                                    {isSidebarOpen && (
                                        <span className="text-[10px] opacity-60 truncate">{sub}</span>
                                    )}
                                </div>
                                {isSidebarOpen && (
                                    <Badge
                                        variant={isSelected ? 'default' : 'secondary'}
                                        className={`text-[10px] h-4 px-1 font-normal flex-shrink-0 ml-1 ${
                                            isSelected ? 'bg-blue-600 text-white' : ''
                                        }`}
                                    >
                                        {stat.count}
                                    </Badge>
                                )}
                            </button>
                        )
                    })}

                    {dailyStats.length === 0 && isSidebarOpen && (
                        <div className="text-center py-6 text-xs text-zinc-400">
                            暂无历史日期
                        </div>
                    )}
                </div>
            </div>

            {/* 右侧主工作区 */}
            <div className="flex-1 flex flex-col min-w-0 h-full">
                {/* 头部 */}
                <div className="flex-shrink-0 pb-4 border-b border-zinc-200 dark:border-zinc-800">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                            <div>
                                <div className="flex items-center gap-2">
                                    <h2 className="text-xl font-semibold">剪贴板历史</h2>
                                    {selectedDate && (
                                        <Badge variant="outline" className="bg-blue-50/50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800 text-blue-600 dark:text-blue-400 text-xs flex items-center gap-1 py-0.5">
                                            <Calendar className="h-3 w-3" />
                                            <span>{selectedDateObj?.title} ({selectedDate})</span>
                                            <button
                                                onClick={() => handleSelectDate(null)}
                                                className="ml-1 hover:text-red-500 rounded-full"
                                                title="清除日期过滤"
                                            >
                                                <X className="h-3 w-3" />
                                            </button>
                                        </Badge>
                                    )}
                                </div>
                                <p className="text-sm text-zinc-500 mt-0.5">
                                    {selectedDate
                                        ? `当前日期共 ${items.length} 条记录 (上限 10,000 条)`
                                        : stats
                                            ? `共 ${stats.total} 条记录 (上限 10,000 条)`
                                            : '加载中...'}
                                </p>
                            </div>
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
                            placeholder={selectedDate ? `在 ${selectedDate} 记录中搜索...` : "搜索剪贴板内容..."}
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

                    {/* 类型筛选统计徽章 */}
                    {stats && Object.keys(stats.byType).length > 0 && (
                        <div className="flex items-center gap-2 mt-3 flex-wrap">
                            <button
                                onClick={() => setSelectedType(null)}
                                className={`text-xs px-2.5 py-1 rounded-md transition-all flex items-center gap-1.5 ${
                                    selectedType === null
                                        ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 font-medium'
                                        : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                                }`}
                            >
                                全部类型
                            </button>
                            {Object.entries(stats.byType).map(([type, count]) => {
                                const isSelected = selectedType === type
                                return (
                                    <button
                                        key={type}
                                        onClick={() => setSelectedType(isSelected ? null : (type as ClipboardItemType))}
                                        className={`text-xs px-2.5 py-1 rounded-md transition-all flex items-center gap-1.5 ${
                                            isSelected
                                                ? 'bg-blue-600 text-white font-medium shadow-sm'
                                                : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                                        }`}
                                    >
                                        {getTypeIcon(type as ClipboardItemType)}
                                        <span>{type}</span>
                                        <span className="opacity-70 text-[11px]">({count})</span>
                                    </button>
                                )
                            })}
                            {selectedType && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setSelectedType(null)}
                                    className="h-6 px-2 text-xs text-zinc-400 hover:text-zinc-600"
                                >
                                    <FilterX className="h-3 w-3 mr-1" />
                                    清除类型筛选
                                </Button>
                            )}
                        </div>
                    )}
                </div>

                {/* 内容区域（网格卡片） */}
                <div className="flex-1 overflow-auto py-4">
                    {loading && items.length === 0 ? (
                        <div className="flex items-center justify-center h-40 text-zinc-500">
                            <RefreshCw className="h-5 w-5 mr-2 animate-spin" />
                            加载中...
                        </div>
                    ) : filteredItems.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-40 text-zinc-500">
                            <Copy className="h-10 w-10 mb-3 opacity-30" />
                            <p>
                                {selectedDate
                                    ? `${selectedDateObj?.title || selectedDate} 暂无匹配记录`
                                    : searchQuery
                                        ? '未找到匹配的剪贴板内容'
                                        : '暂无剪贴板记录'}
                            </p>
                            {selectedDate && (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="mt-3 text-xs"
                                    onClick={() => handleSelectDate(null)}
                                >
                                    查看全部日期
                                </Button>
                            )}
                        </div>
                    ) : (
                        <>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 auto-rows-max">
                                {filteredItems.map(item => (
                                    <div key={item.id}>
                                        <ClipboardCard
                                            item={item}
                                            onCopy={handleCopy}
                                            onDelete={handleDelete}
                                            onPreview={handlePreview}
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

            <ImagePreviewDialog
                item={previewItem}
                open={!!previewItem}
                onOpenChange={(open) => {
                    if (!open) setPreviewItem(null)
                }}
                onCopy={handleCopy}
            />
        </div>
    )
}
