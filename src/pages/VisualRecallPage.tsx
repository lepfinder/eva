import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
    MonitorPlay,
    Pause,
    Play,
    Clock,
    Image as ImageIcon,
    RefreshCw,
    Calendar,
    ChevronLeft,
    ChevronRight,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent } from '@/components/ui/dialog'
// Temporary fallback if hooks missing
const useToast = () => ({ toast: (props: any) => console.log('Toast:', props) })
import clsx from 'clsx'

// 类型定义
interface Snapshot {
    id: number
    timestamp: number
    app_name: string
    window_title: string
    screenshot_path: string
    ocr_text?: string // Deprecated
    imageUrl?: string // Injected by main process
}

export function VisualRecallPage() {
    const { toast } = useToast()

    // 状态
    const [enabled, setEnabled] = useState(false)
    const [loading, setLoading] = useState(false)
    const [snapshots, setSnapshots] = useState<Snapshot[]>([])
    const searchQuery = '' // Keeping as constant for now if we want to add search back later
    const [selectedSnapshot, setSelectedSnapshot] = useState<Snapshot | null>(null)
    const [page, setPage] = useState(1)
    const [hasMore, setHasMore] = useState(true)
    const [selectedDate, setSelectedDate] = useState<Date>(new Date()) // 日期选择
    const PAGE_SIZE = 50

    // 监听滚动加载的 ref
    const observerTarget = useRef<HTMLDivElement>(null)

    // 初始加载配置
    useEffect(() => {
        if (window.api.visualRecall) {
            window.api.visualRecall.getConfig().then(config => {
                setEnabled(config.enabled)
            })
        }
    }, [])

    // 加载数据
    const loadSnapshots = useCallback(async (reset = false) => {
        if (!window.api.visualRecall) return

        setLoading(true)
        try {
            let results: any
            if (searchQuery.trim()) {
                // Search mode
                results = await window.api.visualRecall.searchContent({
                    query: searchQuery,
                    limit: PAGE_SIZE
                })
                if (reset) {
                    setSnapshots(results)
                } else {
                    setSnapshots(results)
                }
                setHasMore(false)
            } else {
                // List mode - 按日期过滤
                const startOfDay = new Date(selectedDate)
                startOfDay.setHours(0, 0, 0, 0)
                const endOfDay = new Date(selectedDate)
                endOfDay.setHours(23, 59, 59, 999)

                // 分页时使用上一次最后一条的时间戳作为 endTime
                const endTime = reset
                    ? endOfDay.getTime()
                    : (snapshots.length > 0 ? snapshots[snapshots.length - 1].timestamp - 1 : endOfDay.getTime())

                const response = await window.api.visualRecall.searchSnapshots({
                    startTime: startOfDay.getTime(),
                    endTime: endTime,
                    limit: PAGE_SIZE
                })

                if (reset) {
                    setSnapshots(response.snapshots)
                } else {
                    // 去重
                    const existingIds = new Set(snapshots.map(s => s.id))
                    const newSnapshots = response.snapshots.filter(s => !existingIds.has(s.id))
                    setSnapshots(prev => [...prev, ...newSnapshots])
                }

                setHasMore(response.snapshots.length === PAGE_SIZE)
                if (!reset && response.snapshots.length > 0) {
                    setPage(p => p + 1)
                }
            }
        } catch (error) {
            console.error('Failed to load snapshots:', error)
        } finally {
            setLoading(false)
        }
    }, [page, snapshots, searchQuery, selectedDate])

    // 搜索处理
    useEffect(() => {
        const timer = setTimeout(() => {
            loadSnapshots(true)
        }, 300) // Debounce
        return () => clearTimeout(timer)
    }, [searchQuery])

    // 日期变化时重新加载
    useEffect(() => {
        loadSnapshots(true)
    }, [selectedDate])

    // 切换录制状态
    const toggleRecording = async () => {
        if (!window.api.visualRecall) return
        const newState = !enabled
        await window.api.visualRecall.setEnabled(newState)
        setEnabled(newState)
        toast({
            title: newState ? "视觉回溯已开启" : "视觉回溯已暂停",
            description: newState ? "系统将自动记录屏幕快照" : "记录已停止",
        })
    }


    // 无限滚动
    useEffect(() => {
        const observer = new IntersectionObserver(
            entries => {
                if (entries[0].isIntersecting && hasMore && !loading && !searchQuery) {
                    loadSnapshots(false)
                }
            },
            { threshold: 1.0 }
        )

        if (observerTarget.current) {
            observer.observe(observerTarget.current)
        }

        return () => observer.disconnect()
    }, [hasMore, loading, searchQuery, loadSnapshots])


    // 辅助函数
    const formatTime = (timestamp: number) => {
        return new Date(timestamp).toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
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

    // 分组逻辑
    const groupedSnapshots = useMemo(() => {
        const groups: Record<string, Snapshot[]> = {}
        const today = new Date().toDateString()
        const yesterday = new Date(Date.now() - 86400000).toDateString()

        snapshots.forEach(s => {
            const date = new Date(s.timestamp).toDateString()
            let key = date
            if (date === today) key = 'Today'
            else if (date === yesterday) key = 'Yesterday'

            if (!groups[key]) groups[key] = []
            groups[key].push(s)
        })

        // Sort keys: Today first, then Yesterday, then others descending
        return Object.entries(groups).sort((a, b) => {
            if (a[0] === 'Today') return -1
            if (b[0] === 'Today') return 1
            if (a[0] === 'Yesterday') return -1
            if (b[0] === 'Yesterday') return 1
            return new Date(b[0]).getTime() - new Date(a[0]).getTime()
        })
    }, [snapshots])

    return (
        <div className="h-full flex flex-col space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between shrink-0">
                <div className="flex items-center gap-4">
                    <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                        <MonitorPlay className="h-6 w-6 text-primary" />
                        视觉回溯
                    </h2>
                    <Badge variant={enabled ? "default" : "secondary"} className={clsx("gap-1", enabled ? "bg-green-600 hover:bg-green-700" : "")}>
                        {enabled ? <Clock className="h-3 w-3 animate-pulse" /> : <Pause className="h-3 w-3" />}
                        {enabled ? "正在记录" : "已暂停"}
                    </Badge>
                </div>

                <div className="flex items-center gap-2">
                    {/* 日期选择器 */}
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                            const prev = new Date(selectedDate)
                            prev.setDate(prev.getDate() - 1)
                            setSelectedDate(prev)
                        }}
                        title="前一天"
                    >
                        <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/50 border">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        <input
                            type="date"
                            value={selectedDate.toISOString().split('T')[0]}
                            onChange={(e) => setSelectedDate(new Date(e.target.value))}
                            max={new Date().toISOString().split('T')[0]}
                            className="bg-transparent border-none outline-none text-sm font-medium w-32"
                        />
                    </div>
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                            const next = new Date(selectedDate)
                            next.setDate(next.getDate() + 1)
                            if (next <= new Date()) {
                                setSelectedDate(next)
                            }
                        }}
                        disabled={selectedDate.toDateString() === new Date().toDateString()}
                        title="后一天"
                    >
                        <ChevronRight className="h-4 w-4" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedDate(new Date())}
                        className={clsx(
                            selectedDate.toDateString() === new Date().toDateString() && "bg-primary/10 text-primary"
                        )}
                    >
                        今天
                    </Button>

                    <div className="w-px h-6 bg-border mx-1" />

                    {/* 刷新和控制按钮 */}
                    <Button variant="ghost" size="icon" onClick={() => loadSnapshots(true)} disabled={loading} title="刷新">
                        <RefreshCw className={clsx("h-4 w-4", loading && "animate-spin")} />
                    </Button>
                    <Button variant="outline" size="sm" onClick={toggleRecording}>
                        {enabled ? <Pause className="h-4 w-4 mr-1" /> : <Play className="h-4 w-4 mr-1" />}
                        {enabled ? "暂停记录" : "继续记录"}
                    </Button>
                </div>
            </div>

            {/* Grid Content */}
            <div className="flex-1 overflow-y-auto min-h-0 pr-2">
                {snapshots.length === 0 && !loading ? (
                    <div className="h-full flex flex-col items-center justify-center text-muted-foreground p-8">
                        <ImageIcon className="h-12 w-12 mb-4 opacity-20" />
                        <p>暂无视觉记录</p>
                    </div>
                ) : (
                    <div className="space-y-6 pb-4">
                        {groupedSnapshots.map(([dateKey, groupSnapshots]) => (
                            <div key={dateKey}>
                                <div className="flex items-center gap-2 mb-3 mt-2">
                                    <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider bg-muted/50 px-2 py-1 rounded inline-block">
                                        {dateKey === 'Today' ? '今天' : dateKey === 'Yesterday' ? '昨天' : dateKey}
                                    </h3>
                                    <span className="text-xs text-muted-foreground/60">共 {groupSnapshots.length} 条</span>
                                    <div className="h-[1px] flex-1 bg-border/50"></div>
                                </div>

                                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                                    {groupSnapshots.map(snapshot => (
                                        <Card
                                            key={snapshot.id}
                                            className="overflow-hidden cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all group border-0 shadow-md bg-card/50"
                                            onClick={() => setSelectedSnapshot(snapshot)}
                                        >
                                            <div className="aspect-video bg-muted relative overflow-hidden">
                                                {/* Thumbnail */}
                                                {snapshot.imageUrl ? (
                                                    <img
                                                        src={snapshot.imageUrl}
                                                        alt={snapshot.window_title}
                                                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                                                        loading="lazy"
                                                    />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center text-muted-foreground bg-secondary/50">
                                                        <ImageIcon className="h-8 w-8 opacity-50" />
                                                    </div>
                                                )}

                                                {/* Timestamp Overlay */}
                                                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-3 pt-8 flex justify-between items-end">
                                                    <p className="text-xs text-white font-mono font-medium drop-shadow-md">
                                                        {formatTime(snapshot.timestamp)}
                                                    </p>
                                                    <span className="text-[10px] text-zinc-300 font-medium opacity-80">
                                                        {getRelativeTime(snapshot.timestamp)}
                                                    </span>
                                                </div>
                                            </div>
                                            <CardContent className="p-3">
                                                <div className="flex items-center justify-between gap-2">
                                                    <div className="flex items-center gap-2 min-w-0">
                                                        <span className="text-sm font-semibold truncate text-foreground/90" title={snapshot.app_name}>
                                                            {snapshot.app_name}
                                                        </span>
                                                    </div>
                                                </div>
                                                <p className="text-xs text-muted-foreground truncate mt-1 leading-relaxed" title={snapshot.window_title}>
                                                    {snapshot.window_title}
                                                </p>
                                            </CardContent>
                                        </Card>
                                    ))}
                                </div>
                            </div>
                        ))}

                        {/* Sentinel for infinite scroll */}
                        <div ref={observerTarget} className="h-1 w-full"></div>
                    </div>
                )}

                {loading && (
                    <div className="py-4 text-center text-muted-foreground text-sm flex items-center justify-center gap-2">
                        <RefreshCw className="h-3 w-3 animate-spin" /> 加载中...
                    </div>
                )}
            </div>

            {/* Detail Dialog */}
            <Dialog open={!!selectedSnapshot} onOpenChange={(open) => !open && setSelectedSnapshot(null)}>
                <DialogContent className="max-w-7xl h-[85vh] flex flex-col p-0 gap-0 overflow-hidden border-none shadow-2xl bg-zinc-950">
                    {selectedSnapshot && (
                        <div className="relative w-full h-full flex items-center justify-center bg-black/95 group">
                            {/* Frosted Background */}
                            {selectedSnapshot.imageUrl && (
                                <div
                                    className="absolute inset-0 bg-cover bg-center blur-3xl opacity-20 scale-110"
                                    style={{ backgroundImage: `url(${selectedSnapshot.imageUrl})` }}
                                />
                            )}

                            {/* Main Image */}
                            <div className="relative z-10 w-full h-full flex flex-col">
                                <div className="flex-1 flex items-center justify-center p-4">
                                    {selectedSnapshot.imageUrl ? (
                                        <img
                                            src={selectedSnapshot.imageUrl.includes('?') ? selectedSnapshot.imageUrl + '&type=full' : selectedSnapshot.imageUrl + '?type=full'}
                                            alt="Full size"
                                            className="max-w-full max-h-full object-contain shadow-2xl rounded-sm"
                                        />
                                    ) : (
                                        <span className="text-white/50">图片不可用</span>
                                    )}
                                </div>

                                {/* Bottom Info Bar */}
                                <div className="shrink-0 bg-gradient-to-t from-black/90 to-transparent p-6 pb-8 text-white relative z-20">
                                    <div className="flex items-end justify-between max-w-5xl mx-auto w-full">
                                        <div className="space-y-1">
                                            <div className="flex items-center gap-3">
                                                <h3 className="text-2xl font-bold tracking-tight drop-shadow-md">{selectedSnapshot.app_name}</h3>
                                                <span className="px-2 py-0.5 rounded bg-white/20 backdrop-blur-md text-xs font-mono border border-white/10">
                                                    {formatTime(selectedSnapshot.timestamp)}
                                                </span>
                                            </div>
                                            <p className="text-white/80 text-sm font-medium opacity-90 leading-relaxed max-w-2xl drop-shadow-sm">
                                                {selectedSnapshot.window_title}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Close Button Hint */}
                            <div className="absolute top-4 right-4 z-30 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Button variant="ghost" className="text-white hover:bg-white/20" onClick={() => setSelectedSnapshot(null)}>
                                    关闭
                                </Button>
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </div >
    )
}
