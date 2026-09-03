import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
    MonitorPlay,
    Pause,
    Play,
    Clock,
    Image as ImageIcon,
    RefreshCw,
    ChevronLeft,
    ChevronRight,
    Sliders,
    Search,
    X,
    Filter,
    AlertTriangle,
    ShieldCheck,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Slider } from '@/components/ui/slider'
import { invoke } from '@tauri-apps/api/core'
import clsx from 'clsx'
import { DateNavigator } from '@/components/ui/date-picker'
import { TimeCapsule } from '@/components/TimeCapsule'

// 类型定义（与 Rust VrSnapshot camelCase 对应）
interface Snapshot {
    id: number
    timestamp: number
    appName: string
    windowTitle: string
    thumbPath: string
    fullPath?: string
}

// 异步加载截图 data URL（支持缓存）
const imageCache = new Map<string, string>()

function SnapshotImage({ path, className }: { path: string; className?: string }) {
    const [src, setSrc] = useState<string>(() => imageCache.get(path) || '')

    useEffect(() => {
        if (!path) return
        if (imageCache.has(path)) {
            setSrc(imageCache.get(path)!)
            return
        }
        let active = true
        invoke<string>('visual_recall_get_image_data', { path })
            .then(dataUrl => {
                if (!active) return
                imageCache.set(path, dataUrl)
                setSrc(dataUrl)
            })
            .catch(() => {
                if (active) setSrc('')
            })
        return () => {
            active = false
        }
    }, [path])

    if (!src) {
        return (
            <div className={clsx('flex items-center justify-center bg-secondary/50', className)}>
                <ImageIcon className="h-8 w-8 opacity-30 text-muted-foreground" />
            </div>
        )
    }
    return <img src={src} className={className} loading="lazy" alt="snapshot" />
}

const PAGE_SIZE = 200

export function VisualRecallPage() {
    // 状态
    const [enabled, setEnabled] = useState(false)
    const [loading, setLoading] = useState(false)
    const [loadingMore, setLoadingMore] = useState(false)
    const [snapshots, setSnapshots] = useState<Snapshot[]>([])
    const [totalCount, setTotalCount] = useState<number>(0)
    const [selectedSnapshot, setSelectedSnapshot] = useState<Snapshot | null>(null)
    const [selectedDate, setSelectedDate] = useState<Date>(new Date())
    const [selectedApp, setSelectedApp] = useState<string>('all')
    const [searchKeyword, setSearchKeyword] = useState<string>('')
    const observerTarget = useRef<HTMLDivElement | null>(null)

    // 时间轴 scrubber 状态
    const [timelineIndex, setTimelineIndex] = useState<number>(0)
    const [showTimeline, setShowTimeline] = useState<boolean>(false)
    const [isPlaying, setIsPlaying] = useState<boolean>(false)
    const [showTimeCapsule, setShowTimeCapsule] = useState<boolean>(false)
    const [hasPermission, setHasPermission] = useState<boolean>(true)

    // 初始加载配置与权限检测
    useEffect(() => {
        invoke<{ enabled: boolean }>('visual_recall_get_config')
            .then(config => setEnabled(config.enabled))
            .catch(() => {})

        invoke<boolean>('visual_recall_check_permission')
            .then(perm => setHasPermission(perm))
            .catch(() => {})
    }, [])

    const requestPermission = async () => {
        await invoke('visual_recall_request_permission')
        setTimeout(async () => {
            const perm = await invoke<boolean>('visual_recall_check_permission')
            setHasPermission(perm)
        }, 1000)
    }

    // 加载指定日期的快照（首批 200 帧）
    const loadSnapshots = useCallback(async () => {
        setLoading(true)
        try {
            const startOfDay = new Date(selectedDate)
            startOfDay.setHours(0, 0, 0, 0)
            const endOfDay = new Date(selectedDate)
            endOfDay.setHours(23, 59, 59, 999)

            const response = await invoke<{ snapshots: Snapshot[]; total: number }>(
                'visual_recall_search_snapshots',
                {
                    startTime: startOfDay.getTime(),
                    endTime: endOfDay.getTime(),
                    limit: PAGE_SIZE,
                    offset: 0,
                }
            )

            setSnapshots(response.snapshots || [])
            setTotalCount(response.total || 0)
            setTimelineIndex(0)
        } catch (err) {
            console.error('[VisualRecall] loadSnapshots failed:', err)
        } finally {
            setLoading(false)
        }
    }, [selectedDate])

    // 加载更多（下一批 200 帧）
    const loadMore = useCallback(async () => {
        if (loading || loadingMore || snapshots.length >= totalCount) return
        setLoadingMore(true)
        try {
            const startOfDay = new Date(selectedDate)
            startOfDay.setHours(0, 0, 0, 0)
            const endOfDay = new Date(selectedDate)
            endOfDay.setHours(23, 59, 59, 999)

            const response = await invoke<{ snapshots: Snapshot[]; total: number }>(
                'visual_recall_search_snapshots',
                {
                    startTime: startOfDay.getTime(),
                    endTime: endOfDay.getTime(),
                    limit: PAGE_SIZE,
                    offset: snapshots.length,
                }
            )

            if (response.snapshots && response.snapshots.length > 0) {
                setSnapshots(prev => {
                    const existingIds = new Set(prev.map(s => s.id))
                    const newItems = response.snapshots.filter(s => !existingIds.has(s.id))
                    return [...prev, ...newItems]
                })
            }
            setTotalCount(response.total || 0)
        } catch (err) {
            console.error('[VisualRecall] loadMore failed:', err)
        } finally {
            setLoadingMore(false)
        }
    }, [loading, loadingMore, snapshots.length, totalCount, selectedDate])

    // 日期变化时重新加载
    useEffect(() => {
        loadSnapshots()
    }, [selectedDate, loadSnapshots])

    // 监听滚动到底部自动加载更多
    useEffect(() => {
        const target = observerTarget.current
        if (!target) return

        const observer = new IntersectionObserver(
            entries => {
                if (entries[0]?.isIntersecting && !loading && !loadingMore && snapshots.length < totalCount) {
                    loadMore()
                }
            },
            { threshold: 0.1, rootMargin: '300px' }
        )

        observer.observe(target)
        return () => observer.disconnect()
    }, [loadMore, loading, loadingMore, snapshots.length, totalCount])

    const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
        const { scrollTop, scrollHeight, clientHeight } = e.currentTarget
        if (scrollHeight - scrollTop - clientHeight < 300 && !loading && !loadingMore && snapshots.length < totalCount) {
            loadMore()
        }
    }

    // 切换录制状态
    const toggleRecording = async () => {
        const newState = !enabled
        await invoke('visual_recall_set_enabled', { enabled: newState })
        setEnabled(newState)
    }

    // 过滤快照
    const filteredSnapshots = useMemo(() => {
        return snapshots.filter(s => {
            const matchApp = selectedApp === 'all' || s.appName.toLowerCase() === selectedApp.toLowerCase()
            const matchKeyword =
                !searchKeyword.trim() ||
                s.appName.toLowerCase().includes(searchKeyword.toLowerCase()) ||
                s.windowTitle.toLowerCase().includes(searchKeyword.toLowerCase())
            return matchApp && matchKeyword
        })
    }, [snapshots, selectedApp, searchKeyword])

    // 按时间顺序正序排序的快照（用于时间轴 scrubbing）
    const chronologicalSnapshots = useMemo(() => {
        return [...filteredSnapshots].sort((a, b) => a.timestamp - b.timestamp)
    }, [filteredSnapshots])

    // 当前时间轴所选中的快照
    const activeTimelineSnapshot = useMemo(() => {
        if (chronologicalSnapshots.length === 0) return null
        const idx = Math.min(timelineIndex, chronologicalSnapshots.length - 1)
        return chronologicalSnapshots[idx] || null
    }, [chronologicalSnapshots, timelineIndex])

    // 提取出现过的应用列表（用于快速标签筛选）
    const appOptions = useMemo(() => {
        const counts: Record<string, number> = {}
        snapshots.forEach(s => {
            if (s.appName) {
                counts[s.appName] = (counts[s.appName] || 0) + 1
            }
        })
        return Object.entries(counts).sort((a, b) => b[1] - a[1])
    }, [snapshots])

    // 辅助时间格式化
    const formatTime = (timestamp: number) => {
        return new Date(timestamp).toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
        })
    }

    const getRelativeTime = (timestamp: number) => {
        const now = Date.now()
        const diff = now - timestamp
        if (diff < 60 * 1000) return '刚刚'
        if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)}分钟前`
        if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)}小时前`
        return ''
    }

    // 弹窗按键快捷导航 (上一张/下一张)
    useEffect(() => {
        if (!selectedSnapshot) return

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'ArrowLeft') {
                const curIdx = filteredSnapshots.findIndex(s => s.id === selectedSnapshot.id)
                if (curIdx > 0) {
                    setSelectedSnapshot(filteredSnapshots[curIdx - 1])
                }
            } else if (e.key === 'ArrowRight') {
                const curIdx = filteredSnapshots.findIndex(s => s.id === selectedSnapshot.id)
                if (curIdx >= 0 && curIdx < filteredSnapshots.length - 1) {
                    setSelectedSnapshot(filteredSnapshots[curIdx + 1])
                }
            } else if (e.key === 'Escape') {
                setSelectedSnapshot(null)
            }
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [selectedSnapshot, filteredSnapshots])

    // 时间轴自动播放
    useEffect(() => {
        if (!isPlaying || !showTimeline || chronologicalSnapshots.length === 0) return
        const timer = setInterval(() => {
            setTimelineIndex(prev => {
                if (prev >= chronologicalSnapshots.length - 1) {
                    setIsPlaying(false)
                    return prev
                }
                return prev + 1
            })
        }, 300)
        return () => clearInterval(timer)
    }, [isPlaying, showTimeline, chronologicalSnapshots.length])

    // 时间轴独立弹窗快捷按键
    useEffect(() => {
        if (!showTimeline) return

        const handleKeyDown = (e: KeyboardEvent) => {
            if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return

            if (e.key === 'ArrowLeft') {
                e.preventDefault()
                setIsPlaying(false)
                setTimelineIndex(prev => Math.max(0, prev - 1))
            } else if (e.key === 'ArrowRight') {
                e.preventDefault()
                setIsPlaying(false)
                setTimelineIndex(prev => Math.min(chronologicalSnapshots.length - 1, prev + 1))
            } else if (e.key === ' ') {
                e.preventDefault()
                setIsPlaying(prev => !prev)
            } else if (e.key === 'Escape') {
                setShowTimeline(false)
                setIsPlaying(false)
            }
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [showTimeline, chronologicalSnapshots.length])

    return (
        <div className="h-full flex flex-col space-y-4">
            {/* 权限提示横幅 */}
            {!hasPermission && (
                <div className="flex items-center justify-between p-3 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-500 text-xs shrink-0">
                    <div className="flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 shrink-0" />
                        <span>
                            <strong>未授予屏幕录制权限：</strong> macOS 系统在此状态下仅允许截取壁纸背景。请前往「系统设置」→「隐私与安全性」→「屏幕录制」勾选 EVA。
                        </span>
                    </div>
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={requestPermission}
                        className="h-7 text-xs border-amber-500/40 text-amber-500 hover:bg-amber-500/10 shrink-0 ml-3"
                    >
                        <ShieldCheck className="h-3.5 w-3.5 mr-1" />
                        申请授权 / 检查
                    </Button>
                </div>
            )}

            {/* Header 顶部操作栏 */}
            <div className="flex flex-wrap items-center justify-between gap-3 shrink-0 relative z-20">
                <div className="flex items-center gap-3">
                    <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                        <MonitorPlay className="h-6 w-6 text-primary" />
                        视觉回溯
                    </h2>
                    <Badge
                        variant={enabled ? 'default' : 'secondary'}
                        className={clsx('gap-1', enabled ? 'bg-green-600 hover:bg-green-700' : '')}
                    >
                        {enabled ? <Clock className="h-3 w-3 animate-pulse" /> : <Pause className="h-3 w-3" />}
                        {enabled ? '正在连续记录' : '已暂停'}
                    </Badge>
                    <span className="text-xs text-muted-foreground hidden sm:inline">
                        共 {totalCount} 帧
                        {snapshots.length < totalCount && (
                            <span className="opacity-70 ml-1">
                                (已加载 {snapshots.length})
                            </span>
                        )}
                    </span>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                    {/* 现代一体化日期导航器 */}
                    <DateNavigator
                        value={selectedDate}
                        onChange={setSelectedDate}
                        maxDate={new Date()}
                    />

                    <div className="w-px h-5 bg-border/80 mx-1" />

                    {/* 时间轴弹窗按钮 */}
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                            if (chronologicalSnapshots.length > 0) {
                                setTimelineIndex(chronologicalSnapshots.length - 1)
                            }
                            setShowTimeline(true)
                        }}
                        className="gap-1.5 text-xs h-8 px-2.5 rounded-xl border-border/70 hover:bg-muted/80 font-medium transition-all"
                        title="打开时间轴实时回溯独立窗口"
                    >
                        <Sliders className="h-3.5 w-3.5 text-muted-foreground" />
                        时间轴
                    </Button>

                    {/* 刷新和控制按钮 */}
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => loadSnapshots()}
                        disabled={loading}
                        className="h-8 w-8 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/80"
                        title="刷新"
                    >
                        <RefreshCw className={clsx('h-3.5 w-3.5', loading && 'animate-spin')} />
                    </Button>

                    <Button
                        variant={enabled ? 'outline' : 'default'}
                        size="sm"
                        onClick={toggleRecording}
                        className={clsx(
                            'h-8 px-3 rounded-xl text-xs font-medium gap-1.5 shadow-xs transition-all',
                            !enabled && 'bg-emerald-600 hover:bg-emerald-700 text-white border-transparent hover:shadow-sm'
                        )}
                    >
                        {enabled ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                        {enabled ? '暂停记录' : '启动记录'}
                    </Button>

                    {/* 时光胶囊播放 */}
                    <Button
                        size="sm"
                        onClick={() => setShowTimeCapsule(true)}
                        className="gap-1 bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700 text-white shadow-xs h-8 px-2.5 rounded-xl text-xs font-medium"
                        title="全屏沉浸式时光胶囊回放"
                    >
                        <Play className="h-3.5 w-3.5 fill-current" />
                        时光胶囊
                    </Button>
                </div>
            </div>

            {/* 筛选与搜索工具条 */}
            <div className="flex flex-wrap items-center justify-between gap-2.5 pb-1 shrink-0">
                {/* 搜索框 */}
                <div className="relative flex-1 max-w-sm">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <input
                        type="text"
                        placeholder="搜索应用名或窗口标题..."
                        value={searchKeyword}
                        onChange={e => setSearchKeyword(e.target.value)}
                        className="w-full bg-muted/40 border rounded-md pl-8 pr-8 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    {searchKeyword && (
                        <button
                            onClick={() => setSearchKeyword('')}
                            className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
                        >
                            <X className="h-3.5 w-3.5" />
                        </button>
                    )}
                </div>

                {/* 应用类型 Tag 过滤 */}
                <div className="flex items-center gap-1.5 overflow-x-auto py-1 scrollbar-none max-w-full">
                    <Filter className="h-3.5 w-3.5 text-muted-foreground shrink-0 mr-1" />
                    <Button
                        size="sm"
                        variant={selectedApp === 'all' ? 'default' : 'ghost'}
                        onClick={() => setSelectedApp('all')}
                        className="h-7 text-xs px-2.5 rounded-full"
                    >
                        全部 ({totalCount})
                    </Button>
                    {appOptions.slice(0, 8).map(([appName, count]) => (
                        <Button
                            key={appName}
                            size="sm"
                            variant={selectedApp === appName ? 'default' : 'ghost'}
                            onClick={() => setSelectedApp(appName)}
                            className="h-7 text-xs px-2.5 rounded-full whitespace-nowrap"
                        >
                            {appName} <span className="ml-1 opacity-60 text-[10px]">{count}</span>
                        </Button>
                    ))}
                </div>
            </div>



            {/* 网格视图 Content */}
            <div className="flex-1 overflow-y-auto min-h-0 pr-2" onScroll={handleScroll}>
                {filteredSnapshots.length === 0 && !loading ? (
                    <div className="h-full flex flex-col items-center justify-center text-muted-foreground p-8">
                        <ImageIcon className="h-12 w-12 mb-4 opacity-20" />
                        <p>未找到匹配的视觉记录</p>
                        <p className="text-xs text-muted-foreground/60 mt-1">
                            {enabled ? '系统正在后台持续智能捕获中...' : '录制当前处于暂停状态，点击右上角“启动”即可开启'}
                        </p>
                    </div>
                ) : (
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3.5 pb-6">
                        {filteredSnapshots.map(snapshot => (
                            <Card
                                key={snapshot.id}
                                className="overflow-hidden cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all group border shadow-sm bg-card/60"
                                onClick={() => setSelectedSnapshot(snapshot)}
                            >
                                <div className="aspect-video bg-muted relative overflow-hidden">
                                    {/* Thumbnail */}
                                    <SnapshotImage
                                        path={snapshot.thumbPath}
                                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                                    />

                                    {/* Timestamp Overlay */}
                                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent p-2.5 pt-6 flex justify-between items-end">
                                        <p className="text-xs text-white font-mono font-medium drop-shadow-md">
                                            {formatTime(snapshot.timestamp)}
                                        </p>
                                        <span className="text-[10px] text-zinc-300 font-medium opacity-80">
                                            {getRelativeTime(snapshot.timestamp)}
                                        </span>
                                    </div>
                                </div>
                                <CardContent className="p-2.5">
                                    <div className="flex items-center justify-between gap-1.5">
                                        <span
                                            className="text-xs font-semibold truncate text-foreground"
                                            title={snapshot.appName}
                                        >
                                            {snapshot.appName}
                                        </span>
                                    </div>
                                    <p
                                        className="text-[11px] text-muted-foreground truncate mt-0.5"
                                        title={snapshot.windowTitle}
                                    >
                                        {snapshot.windowTitle}
                                    </p>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                )}

                {/* 底部加载更多与哨兵元素 */}
                {!loading && snapshots.length > 0 && (
                    <div ref={observerTarget} className="py-4 flex flex-col items-center justify-center text-xs text-muted-foreground">
                        {loadingMore ? (
                            <div className="flex items-center gap-2 py-2">
                                <RefreshCw className="h-4 w-4 animate-spin text-primary" />
                                <span>正在载入更多历史帧...</span>
                            </div>
                        ) : snapshots.length < totalCount ? (
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={loadMore}
                                className="text-xs h-8 rounded-lg text-muted-foreground hover:text-foreground"
                            >
                                滚动加载更多 (已载入 {snapshots.length} / 共 {totalCount} 帧)
                            </Button>
                        ) : (
                            <p className="text-muted-foreground/60 py-2">
                                已显示全天全部 {totalCount} 帧记录
                            </p>
                        )}
                    </div>
                )}

                {loading && (
                    <div className="py-8 text-center text-muted-foreground text-sm flex items-center justify-center gap-2">
                        <RefreshCw className="h-4 w-4 animate-spin" /> 加载中...
                    </div>
                )}
            </div>

            {/* 大图回放与左右切换 Dialog (借鉴 Screenpipe 快捷沉浸回看) */}
            <Dialog open={!!selectedSnapshot} onOpenChange={open => !open && setSelectedSnapshot(null)}>
                <DialogContent className="max-w-7xl h-[88vh] flex flex-col p-0 gap-0 overflow-hidden border-none shadow-2xl bg-zinc-950">
                    {selectedSnapshot && (
                        <div className="relative w-full h-full flex items-center justify-center bg-black/95 group">
                            {/* 背景微模糊 */}
                            {selectedSnapshot.thumbPath && (
                                <SnapshotImage
                                    path={selectedSnapshot.thumbPath}
                                    className="absolute inset-0 w-full h-full object-cover blur-3xl opacity-20 scale-110 pointer-events-none"
                                />
                            )}

                            {/* 主画面 */}
                            <div className="relative z-10 w-full h-full flex flex-col">
                                <div className="flex-1 flex items-center justify-center p-4 min-h-0 relative">
                                    {/* 左右快捷切换按钮 */}
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="absolute left-4 top-1/2 -translate-y-1/2 text-white/70 hover:text-white bg-black/40 hover:bg-black/70 rounded-full h-10 w-10 z-20"
                                        onClick={e => {
                                            e.stopPropagation()
                                            const curIdx = filteredSnapshots.findIndex(s => s.id === selectedSnapshot.id)
                                            if (curIdx > 0) {
                                                setSelectedSnapshot(filteredSnapshots[curIdx - 1])
                                            }
                                        }}
                                        title="上一帧 (←)"
                                    >
                                        <ChevronLeft className="h-6 w-6" />
                                    </Button>

                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="absolute right-4 top-1/2 -translate-y-1/2 text-white/70 hover:text-white bg-black/40 hover:bg-black/70 rounded-full h-10 w-10 z-20"
                                        onClick={e => {
                                            e.stopPropagation()
                                            const curIdx = filteredSnapshots.findIndex(s => s.id === selectedSnapshot.id)
                                            if (curIdx >= 0 && curIdx < filteredSnapshots.length - 1) {
                                                setSelectedSnapshot(filteredSnapshots[curIdx + 1])
                                            }
                                        }}
                                        title="下一帧 (→)"
                                    >
                                        <ChevronRight className="h-6 w-6" />
                                    </Button>

                                    {selectedSnapshot.fullPath || selectedSnapshot.thumbPath ? (
                                        <SnapshotImage
                                            path={selectedSnapshot.fullPath ?? selectedSnapshot.thumbPath!}
                                            className="max-w-full max-h-full object-contain shadow-2xl rounded-sm"
                                        />
                                    ) : (
                                        <span className="text-white/50">图片不可用</span>
                                    )}
                                </div>

                                {/* 底部详细信息 */}
                                <div className="shrink-0 bg-gradient-to-t from-black/90 to-transparent p-5 pb-6 text-white relative z-20">
                                    <div className="flex items-end justify-between max-w-5xl mx-auto w-full">
                                        <div className="space-y-1 min-w-0 pr-4">
                                            <div className="flex items-center gap-3">
                                                <h3 className="text-xl font-bold tracking-tight drop-shadow-md">
                                                    {selectedSnapshot.appName}
                                                </h3>
                                                <span className="px-2 py-0.5 rounded bg-white/20 backdrop-blur-md text-xs font-mono border border-white/10">
                                                    {formatTime(selectedSnapshot.timestamp)}
                                                </span>
                                                <span className="text-xs text-white/60">
                                                    (按 ← / → 键盘左右方向键切换)
                                                </span>
                                            </div>
                                            <p className="text-white/80 text-sm font-medium opacity-90 leading-relaxed truncate max-w-2xl drop-shadow-sm">
                                                {selectedSnapshot.windowTitle}
                                            </p>
                                        </div>

                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="text-white/80 hover:text-white hover:bg-white/10"
                                            onClick={() => setSelectedSnapshot(null)}
                                        >
                                            关闭 (Esc)
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>

            {/* 时间轴独立回溯弹窗 (拖动滑块实时展示对应画面) */}
            <Dialog
                open={showTimeline}
                onOpenChange={open => {
                    setShowTimeline(open)
                    if (!open) setIsPlaying(false)
                }}
            >
                <DialogContent className="max-w-7xl w-[94vw] h-[90vh] flex flex-col p-0 gap-0 overflow-hidden border border-zinc-800 shadow-2xl bg-zinc-950 text-white select-none">
                    {/* 顶部标题栏 */}
                    <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800/80 bg-zinc-900/60 shrink-0">
                        <div className="flex items-center gap-3">
                            <div className="flex items-center gap-2">
                                <Sliders className="h-4 w-4 text-primary" />
                                <span className="font-semibold text-sm tracking-tight text-white">时间轴回溯</span>
                            </div>
                            {activeTimelineSnapshot && (
                                <Badge variant="secondary" className="bg-zinc-800 text-zinc-300 font-mono text-xs border-zinc-700">
                                    {formatTime(activeTimelineSnapshot.timestamp)}
                                </Badge>
                            )}
                            {activeTimelineSnapshot?.appName && (
                                <Badge className="bg-primary/20 text-primary-foreground border-primary/30 text-xs">
                                    {activeTimelineSnapshot.appName}
                                </Badge>
                            )}
                        </div>

                        <div className="flex items-center gap-3">
                            <span className="text-xs font-mono text-zinc-400">
                                {chronologicalSnapshots.length > 0 ? `${timelineIndex + 1} / ${chronologicalSnapshots.length} 帧` : '无记录'}
                            </span>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs text-zinc-400 hover:text-white hover:bg-zinc-800 px-2"
                                onClick={() => {
                                    setShowTimeline(false)
                                    setIsPlaying(false)
                                }}
                            >
                                关闭 (Esc)
                            </Button>
                        </div>
                    </div>

                    {/* 居中实时画面区 */}
                    <div className="flex-1 min-h-0 relative flex items-center justify-center p-4 bg-black/95 group overflow-hidden">
                        {/* 背景微模糊 */}
                        {activeTimelineSnapshot?.thumbPath && (
                            <SnapshotImage
                                path={activeTimelineSnapshot.thumbPath}
                                className="absolute inset-0 w-full h-full object-cover blur-3xl opacity-20 scale-110 pointer-events-none"
                            />
                        )}

                        {/* 左右单帧快速步进按钮 */}
                        <Button
                            variant="ghost"
                            size="icon"
                            disabled={timelineIndex <= 0}
                            className="absolute left-4 top-1/2 -translate-y-1/2 text-white/70 hover:text-white bg-black/40 hover:bg-black/70 disabled:opacity-20 rounded-full h-10 w-10 z-20 transition-all"
                            onClick={() => {
                                setIsPlaying(false)
                                setTimelineIndex(prev => Math.max(0, prev - 1))
                            }}
                            title="上一帧 (←)"
                        >
                            <ChevronLeft className="h-6 w-6" />
                        </Button>

                        <Button
                            variant="ghost"
                            size="icon"
                            disabled={timelineIndex >= chronologicalSnapshots.length - 1}
                            className="absolute right-4 top-1/2 -translate-y-1/2 text-white/70 hover:text-white bg-black/40 hover:bg-black/70 disabled:opacity-20 rounded-full h-10 w-10 z-20 transition-all"
                            onClick={() => {
                                setIsPlaying(false)
                                setTimelineIndex(prev => Math.min(chronologicalSnapshots.length - 1, prev + 1))
                            }}
                            title="下一帧 (→)"
                        >
                            <ChevronRight className="h-6 w-6" />
                        </Button>

                        {/* 实时画面 */}
                        {activeTimelineSnapshot ? (
                            <SnapshotImage
                                path={activeTimelineSnapshot.fullPath ?? activeTimelineSnapshot.thumbPath}
                                className="max-w-full max-h-full object-contain shadow-2xl rounded-sm"
                            />
                        ) : (
                            <div className="flex flex-col items-center justify-center text-zinc-500 gap-2">
                                <ImageIcon className="h-12 w-12 opacity-30" />
                                <span className="text-sm">暂无当前时间画面</span>
                            </div>
                        )}
                    </div>

                    {/* 底部实时时间轴拖动与交互控制区 */}
                    <div className="shrink-0 bg-zinc-900/95 backdrop-blur border-t border-zinc-800/80 px-6 py-4 space-y-3 z-30">
                        {/* 控制行与应用信息 */}
                        <div className="flex items-center justify-between gap-4">
                            <div className="flex items-center gap-3">
                                {/* 播放/暂停 */}
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => setIsPlaying(!isPlaying)}
                                    className="h-8 px-3 rounded-lg border-zinc-700 bg-zinc-800 text-zinc-100 hover:text-white hover:bg-zinc-700 gap-1.5 text-xs font-medium"
                                    title={isPlaying ? '暂停回放' : '自动回放 (空格键)'}
                                >
                                    {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5 fill-current" />}
                                    {isPlaying ? '暂停' : '播放'}
                                </Button>

                                <div className="h-4 w-px bg-zinc-800" />

                                {/* 时间戳实时呈现 */}
                                <span className="font-mono text-base font-bold text-white tracking-wide">
                                    {activeTimelineSnapshot ? formatTime(activeTimelineSnapshot.timestamp) : '--:--:--'}
                                </span>

                                {activeTimelineSnapshot && (
                                    <span className="text-xs text-zinc-400">
                                        {getRelativeTime(activeTimelineSnapshot.timestamp)}
                                    </span>
                                )}
                            </div>

                            {/* 窗口标题及快捷键说明 */}
                            <div className="flex items-center gap-3 overflow-hidden">
                                {activeTimelineSnapshot?.windowTitle && (
                                    <span
                                        className="text-xs text-zinc-300 truncate max-w-lg font-normal drop-shadow-sm"
                                        title={activeTimelineSnapshot.windowTitle}
                                    >
                                        {activeTimelineSnapshot.windowTitle}
                                    </span>
                                )}
                                <span className="text-[11px] text-zinc-500 hidden lg:inline shrink-0 font-mono">
                                    拖动滑块实时定位 · 方向键微调 · 空格播放
                                </span>
                            </div>
                        </div>

                        {/* 实时时间滑块 Scrubber */}
                        <div className="space-y-1.5 pt-1">
                            <Slider
                                value={[timelineIndex]}
                                min={0}
                                max={Math.max(0, chronologicalSnapshots.length - 1)}
                                step={1}
                                onValueChange={vals => {
                                    setIsPlaying(false)
                                    setTimelineIndex(vals[0])
                                }}
                                className="cursor-pointer py-1.5"
                            />
                            <div className="flex justify-between text-[11px] font-mono text-zinc-500 px-0.5">
                                <span>
                                    {chronologicalSnapshots.length > 0
                                        ? formatTime(chronologicalSnapshots[0].timestamp)
                                        : '00:00:00'}
                                </span>
                                <span className="text-zinc-400">
                                    {activeTimelineSnapshot ? formatTime(activeTimelineSnapshot.timestamp) : ''}
                                </span>
                                <span>
                                    {chronologicalSnapshots.length > 0
                                        ? formatTime(chronologicalSnapshots[chronologicalSnapshots.length - 1].timestamp)
                                        : '23:59:59'}
                                </span>
                            </div>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            {/* 全屏时光胶囊沉浸式回放 */}
            <TimeCapsule
                isOpen={showTimeCapsule}
                onClose={() => setShowTimeCapsule(false)}
                date={`${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, '0')}-${String(selectedDate.getDate()).padStart(2, '0')}`}
            />
        </div>
    )
}
