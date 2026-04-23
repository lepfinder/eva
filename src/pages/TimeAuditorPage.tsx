/**
 * 时间审计页面
 * 展示今日应用使用时间统计
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { RefreshCw, Clock, Monitor, TrendingUp, Sparkles, FolderOpen, FileText, CalendarDays, SearchX, Play, List, EyeOff, ChevronRight, Calendar, ChevronLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts'
import { Slider } from '@/components/ui/slider'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { TimeCapsule } from '@/components/TimeCapsule'
import { ProductivityHeatmap } from '@/components/ProductivityHeatmap'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useVirtualizer } from '@tanstack/react-virtual'

// 类型定义
interface ActivityLog {
    id: string
    appName: string
    windowTitle: string
    startTime: number
    endTime: number
    duration: number
    category?: string
    projectName?: string
    tags?: string[]
    classified?: boolean
    remark?: string
}

interface AppStat {
    appName: string
    totalDuration: number
    percentage: number
}

interface CategoryStat {
    category: string
    totalDuration: number
    percentage: number
}

interface ProjectStat {
    projectName: string
    totalDuration: number
    percentage: number
}

// 颜色配置
const COLORS = [
    '#8b5cf6', // violet
    '#3b82f6', // blue
    '#10b981', // emerald
    '#f59e0b', // amber
    '#ef4444', // red
    '#ec4899', // pink
    '#06b6d4', // cyan
    '#84cc16', // lime
    '#6366f1', // indigo
    '#f97316', // orange
]

// 类别配置
const CATEGORY_CONFIG: Record<string, { name: string; icon: string; color: string }> = {
    development: { name: '开发', icon: '💻', color: '#8b5cf6' },
    operations: { name: '运维', icon: '🚀', color: '#ea580c' },
    research: { name: '调研', icon: '📚', color: '#3b82f6' },
    communication: { name: '沟通', icon: '💬', color: '#10b981' },
    writing: { name: '写作', icon: '✏️', color: '#ec4899' },
    design: { name: '设计', icon: '🎨', color: '#f43f5e' },
    entertainment: { name: '娱乐', icon: '🎮', color: '#f59e0b' },
    productivity: { name: '效率', icon: '📝', color: '#6366f1' },
    browsing: { name: '浏览', icon: '🌐', color: '#06b6d4' },
    distracted: { name: '走神', icon: '😶', color: '#64748b' },
    system: { name: '系统', icon: '⏸️', color: '#9ca3af' },
    offline: { name: '离线', icon: '🌙', color: '#6b7280' },
    other: { name: '其他', icon: '📌', color: '#94a3b8' },
    unclassified: { name: '未分类', icon: '❓', color: '#cbd5e1' },
}

// 获取应用的颜色（如果未分类，根据名称生成固定颜色）
const getAppColor = (appName: string, category?: string) => {
    if (category && category !== 'unclassified' && CATEGORY_CONFIG[category]) {
        return CATEGORY_CONFIG[category].color
    }

    // 确定性颜色生成
    let hash = 0
    for (let i = 0; i < appName.length; i++) {
        hash = appName.charCodeAt(i) + ((hash << 5) - hash)
    }

    // 使用 HSL 以获得更和谐、高饱和度的颜色
    const h = Math.abs(hash % 360)
    return `hsl(${h}, 65%, 45%)`
}

// 格式化时长
function formatDuration(seconds: number): string {
    if (seconds < 60) return `${seconds}秒`
    if (seconds < 3600) return `${Math.floor(seconds / 60)}分钟`
    const hours = Math.floor(seconds / 3600)
    const mins = Math.floor((seconds % 3600) / 60)
    return mins > 0 ? `${hours}小时${mins}分钟` : `${hours}小时`
}

// 格式化时间
function formatTime(timestamp: number): string {
    return new Date(timestamp).toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit'
    })
}

// 自定义 Tooltip
function CustomTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: AppStat }> }) {
    if (!active || !payload || !payload.length) return null
    const data = payload[0].payload
    return (
        <div className="bg-white dark:bg-zinc-900 border rounded-lg shadow-lg p-3">
            <p className="font-medium">{data.appName}</p>
            <p className="text-sm text-zinc-500">{formatDuration(data.totalDuration)}</p>
            <p className="text-sm text-zinc-500">{data.percentage}%</p>
        </div>
    )
}

// 单个活动记录项组件 (支持懒加载缩略图)
const ActivityLogItem = ({ log, visualRecallEnabled }: { log: ActivityLog; visualRecallEnabled: boolean }) => {
    const [thumbnail, setThumbnail] = useState<string | null>(null)
    const [loaded, setLoaded] = useState(false)
    const [isVisible, setIsVisible] = useState(false)
    const ref = useRef<HTMLDivElement>(null)

    const config = log.category ? CATEGORY_CONFIG[log.category] : CATEGORY_CONFIG.unclassified
    const color = getAppColor(log.appName, log.category)

    useEffect(() => {
        if (!ref.current) return
        const observer = new IntersectionObserver(([entry]) => {
            if (entry.isIntersecting) {
                setIsVisible(true)
                observer.disconnect()
            }
        })
        observer.observe(ref.current)
        return () => observer.disconnect()
    }, [])

    useEffect(() => {
        if (isVisible && visualRecallEnabled && !loaded && window.api.visualRecall) {
            window.api.visualRecall.searchSnapshots({
                startTime: log.startTime - 2000,
                endTime: log.endTime + 2000,
                limit: 1
            }).then(res => {
                if (res.snapshots && res.snapshots.length > 0 && res.snapshots[0].imageUrl) {
                    setThumbnail(res.snapshots[0].imageUrl)
                }
            }).catch(console.error).finally(() => setLoaded(true))
        }
    }, [isVisible, visualRecallEnabled, loaded, log])

    return (
        <div
            ref={ref}
            className="flex items-center gap-3 p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors group relative"
        >
            {/* 时间 & 缩略图区域 */}
            <div className="flex items-center gap-3 shrink-0 w-24">
                <div className="w-10 h-7 rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 overflow-hidden shrink-0 flex items-center justify-center relative">
                    {thumbnail ? (
                        <img src={thumbnail} className="w-full h-full object-cover" alt="" />
                    ) : (
                        <div className="text-[10px] text-zinc-300 dark:text-zinc-700">
                            {config?.icon || 'App'}
                        </div>
                    )}
                </div>
                <div className="text-xs text-zinc-500 font-mono">
                    {formatTime(log.startTime)}
                </div>
            </div>

            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium truncate max-w-[180px] text-sm">{log.appName}</p>
                    {log.projectName && (
                        <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[10px] font-bold shrink-0 border border-primary/20">
                            {log.projectName}
                        </span>
                    )}
                    {log.category && log.category !== 'unclassified' && (
                        <span
                            className="px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0 text-white"
                            style={{ backgroundColor: color }}
                        >
                            {config?.name || '其他'}
                        </span>
                    )}
                </div>
                <p className="text-xs text-zinc-400 dark:text-zinc-500 truncate mt-0.5 pr-2">{log.windowTitle}</p>
            </div>
            <div className="text-xs text-zinc-500 shrink-0 tabular-nums bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded">
                {formatDuration(log.duration)}
            </div>
        </div>
    )
}

// 虚拟化活动表格组件 - 只渲染可见行，大幅提升性能
interface VirtualizedActivityTableProps {
    logs: ActivityLog[]
    remarkEdits: Record<string, string>
    setRemarkEdits: React.Dispatch<React.SetStateAction<Record<string, string>>>
    setLogs: React.Dispatch<React.SetStateAction<ActivityLog[]>>
    formatDuration: (seconds: number) => string
}

function VirtualizedActivityTable({ logs, remarkEdits, setRemarkEdits, setLogs, formatDuration }: VirtualizedActivityTableProps) {
    const parentRef = useRef<HTMLDivElement>(null)

    const rowVirtualizer = useVirtualizer({
        count: logs.length,
        getScrollElement: () => parentRef.current,
        estimateSize: () => 44, // 预估行高 44px
        overscan: 10 // 额外渲染 10 行缓冲
    })

    return (
        <div ref={parentRef} className="flex-1 overflow-auto p-4">
            <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white dark:bg-zinc-900 z-10">
                    <tr className="border-b text-left text-zinc-500">
                        <th className="py-2 px-2 w-[100px]">时间</th>
                        <th className="py-2 px-2 w-[120px]">应用</th>
                        <th className="py-2 px-2">窗口标题</th>
                        <th className="py-2 px-2 w-[60px]">时长</th>
                        <th className="py-2 px-2 w-[80px]">类别</th>
                        <th className="py-2 px-2 w-[200px]">备注</th>
                    </tr>
                </thead>
            </table>
            <div
                style={{
                    height: `${rowVirtualizer.getTotalSize()}px`,
                    width: '100%',
                    position: 'relative',
                }}
            >
                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                    const log = logs[virtualRow.index]
                    if (!log) return null

                    const startDate = new Date(log.startTime)
                    const timeStr = `${String(startDate.getHours()).padStart(2, '0')}:${String(startDate.getMinutes()).padStart(2, '0')}`
                    const categoryInfo = CATEGORY_CONFIG[log.category || 'unclassified'] || CATEGORY_CONFIG['other']
                    const remarkValue = remarkEdits[log.id] !== undefined ? remarkEdits[log.id] : (log.remark || '')

                    return (
                        <div
                            key={log.id}
                            style={{
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                width: '100%',
                                height: `${virtualRow.size}px`,
                                transform: `translateY(${virtualRow.start}px)`,
                            }}
                            className="flex items-center border-b border-zinc-100 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-sm"
                        >
                            <div className="py-2 px-2 w-[100px] font-mono text-xs text-zinc-500 shrink-0">{timeStr}</div>
                            <div className="py-2 px-2 w-[120px] truncate shrink-0" title={log.appName}>{log.appName}</div>
                            <div className="py-2 px-2 flex-1 truncate min-w-0" title={log.windowTitle}>{log.windowTitle || '-'}</div>
                            <div className="py-2 px-2 w-[60px] text-xs shrink-0">{formatDuration(log.duration)}</div>
                            <div className="py-2 px-2 w-[80px] shrink-0">
                                <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: `${categoryInfo.color}20`, color: categoryInfo.color }}>
                                    {categoryInfo.icon} {categoryInfo.name}
                                </span>
                            </div>
                            <div className="py-2 px-2 w-[200px] shrink-0">
                                <Input
                                    value={remarkValue}
                                    placeholder="添加备注..."
                                    className="h-7 text-xs"
                                    onChange={(e) => setRemarkEdits(prev => ({ ...prev, [log.id]: e.target.value }))}
                                    onBlur={async () => {
                                        if (remarkEdits[log.id] !== undefined && remarkEdits[log.id] !== (log.remark || '')) {
                                            await invoke('activity_update_remark', { id: log.id, remark: remarkEdits[log.id] || null })
                                            setLogs(prev => prev.map(l => l.id === log.id ? { ...l, remark: remarkEdits[log.id] || undefined } : l))
                                        }
                                    }}
                                />
                            </div>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}

export function TimeAuditorPage() {
    const [stats, setStats] = useState<AppStat[]>([])
    const [logs, setLogs] = useState<ActivityLog[]>([])
    const [categoryStats, setCategoryStats] = useState<CategoryStat[]>([])
    const [projectStats, setProjectStats] = useState<ProjectStat[]>([])
    const [totalDuration, setTotalDuration] = useState(0)
    const [loading, setLoading] = useState(true)
    const [totalCount, setTotalCount] = useState(0)
    const [classifying, setClassifying] = useState(false)
    const [summary, setSummary] = useState<string>('')
    const [generatingSummary, setGeneratingSummary] = useState(false)
    const [hoveredBlock, setHoveredBlock] = useState<any>(null)
    const [hoverPos, setHoverPos] = useState({ x: 0, y: 0 })
    const [hoverThumbnail, setHoverThumbnail] = useState<string | null>(null)
    const [loadingThumbnail, setLoadingThumbnail] = useState(false)
    const [viewRange, setViewRange] = useState<[number, number]>([0, 100])

    // Time Capsule 状态
    const [showTimeCapsule, setShowTimeCapsule] = useState(false)
    // All Activities Dialog
    const [showAllActivities, setShowAllActivities] = useState(false)
    const [remarkEdits, setRemarkEdits] = useState<Record<string, string>>({})
    const [activityFilter, setActivityFilter] = useState('')
    const [categoryFilter, setCategoryFilter] = useState<string>('all')

    // 视觉回溯状态
    const [visualRecallEnabled, setVisualRecallEnabled] = useState(false)


    // 加载视觉回溯配置
    useEffect(() => {
        if (window.api.visualRecall) {
            window.api.visualRecall.getConfig().then(config => {
                setVisualRecallEnabled(config.enabled)
            })
        }
    }, [])



    // Filtered logs for dialog
    const filteredLogs = useMemo(() => {
        let result = logs
        // Category filter
        if (categoryFilter !== 'all') {
            result = result.filter(l => (l.category || 'unclassified') === categoryFilter)
        }
        // Text filter
        if (activityFilter.trim()) {
            const keyword = activityFilter.toLowerCase()
            result = result.filter(l =>
                l.appName.toLowerCase().includes(keyword) ||
                (l.windowTitle || '').toLowerCase().includes(keyword)
            )
        }
        return result
    }, [logs, activityFilter, categoryFilter])

    // 日期选择 (YYYY-MM-DD)
    const [selectedDate, setSelectedDate] = useState<string>(() => {
        const now = new Date()
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    })

    // 加载数据
    const loadData = useCallback(async () => {
        try {
            setLoading(true)

            const [statsData, logsData, total, catStats, projStats, count] = await Promise.all([
                invoke<AppStat[]>('activity_get_today_stats', { date: selectedDate }),
                invoke<ActivityLog[]>('activity_get_today_logs', { date: selectedDate }),
                invoke<number>('activity_get_today_total_duration', { date: selectedDate }),
                invoke<CategoryStat[]>('activity_get_stats_by_category', { date: selectedDate }),
                invoke<ProjectStat[]>('activity_get_stats_by_project', { date: selectedDate }),
                invoke<number>('activity_get_today_logs_count', { date: selectedDate })
            ])
            setStats(statsData)
            setLogs(logsData)
            setTotalDuration(total)
            setCategoryStats(catStats)
            setProjectStats(projStats)
            setTotalCount(count)
        } catch (error) {
            console.error('Failed to load activity data:', error)
        } finally {
            setLoading(false)
        }
    }, [selectedDate])

    // 加载日报总结
    useEffect(() => {
        async function loadSummary() {
            setSummary('')
            if (!selectedDate) return
            try {
                const saved = await invoke<{ content: string; model?: string; createdAt: number } | null>('activity_get_daily_summary', { date: selectedDate })
                if (saved) {
                    setSummary(saved.content)
                }
            } catch (e) {
                console.error('Failed to load daily summary:', e)
            }
        }
        loadSummary()
    }, [selectedDate])

    // AI 分类
    const handleClassify = useCallback(async () => {
        try {
            setClassifying(true)
            const count = await invoke<number>('activity_classify_now')
            console.log(`Classified ${count} activities`)
            // 分类完成后重新加载数据
            await loadData()
        } catch (error) {
            console.error('Failed to classify:', error)
        } finally {
            setClassifying(false)
        }
    }, [loadData])

    // AI 生成总结
    const handleGenerateSummary = useCallback(async () => {
        try {
            setGeneratingSummary(true)
            // 传入选中的日期
            const result = await invoke<string>('activity_generate_summary', { date: selectedDate })
            setSummary(result)
        } catch (error) {
            console.error('Failed to generate summary:', error)
            setSummary('生成总结失败，请重试。')
        } finally {
            setGeneratingSummary(false)
        }
    }, [selectedDate])

    // 初始加载
    useEffect(() => {
        loadData()
        // 每分钟刷新一次
        const interval = setInterval(loadData, 60000)
        return () => clearInterval(interval)
    }, [loadData])

    // 时间轴数据处理
    const timelineData = useMemo(() => {
        // 将日志合并为连续的时间块
        if (logs.length === 0) return []



        // 按时间正序排列
        const sortedLogs = [...logs].sort((a, b) => a.startTime - b.startTime)



        // 简化的合并逻辑：相同分类且间隔很短的合并
        // 这里为了简单展示，直接使用原始 log，但在渲染时处理宽度
        // 实际上，为了这展示效果，我们应该按分钟/小时聚合

        // 简单映射 log 到 timeline 块
        return sortedLogs.map(log => ({
            startTime: log.startTime,
            endTime: log.endTime,
            category: log.category || 'unclassified',
            appName: log.appName,
            windowTitle: log.windowTitle,
            duration: log.duration
        }))
    }, [logs])

    // 计算时间轴范围（显示最早活动到现在的范围，或者固定 0-24即 Today）
    // 为了更直观，我们显示 00:00 到 24:00

    const totalDaySeconds = 24 * 3600

    // 获取应用数量
    const appCount = stats.length

    return (
        <div className="h-full flex flex-col">
            {/* 头部 */}
            <div className="flex-shrink-0 pb-4 border-b border-zinc-200 dark:border-zinc-800">
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-xl font-semibold">时间审计</h2>
                        <p className="text-sm text-zinc-500">追踪你的应用使用时间，了解生产力分布</p>
                    </div>
                    <div className="flex gap-2 items-center">
                        {/* 日期选择器 (统一样式) */}
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                                const prev = new Date(selectedDate)
                                prev.setDate(prev.getDate() - 1)
                                setSelectedDate(prev.toISOString().split('T')[0])
                            }}
                            title="前一天"
                            className="h-9 w-9"
                        >
                            <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 h-9">
                            <Calendar className="h-4 w-4 text-zinc-500" />
                            <input
                                type="date"
                                value={selectedDate}
                                onChange={(e) => setSelectedDate(e.target.value)}
                                max={new Date().toISOString().split('T')[0]}
                                className="bg-transparent border-none outline-none text-sm font-medium w-32 p-0 focus:ring-0"
                            />
                        </div>
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                                const next = new Date(selectedDate)
                                next.setDate(next.getDate() + 1)
                                const todayStr = new Date().toISOString().split('T')[0]
                                const nextStr = next.toISOString().split('T')[0]
                                if (nextStr <= todayStr) {
                                    setSelectedDate(nextStr)
                                }
                            }}
                            disabled={selectedDate === new Date().toISOString().split('T')[0]}
                            title="后一天"
                            className="h-9 w-9"
                        >
                            <ChevronRight className="h-4 w-4" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setSelectedDate(new Date().toISOString().split('T')[0])}
                            className={`h-9 px-3 ${selectedDate === new Date().toISOString().split('T')[0] ? "bg-primary/10 text-primary hover:bg-primary/20 hover:text-primary" : ""}`}
                        >
                            今天
                        </Button>
                        <div className="w-[1px] h-6 bg-zinc-200 dark:bg-zinc-800 mx-1"></div>
                        <Button
                            variant="outline"
                            size="icon"
                            onClick={handleClassify}
                            disabled={classifying || loading}
                            title="AI 分类"
                            className="h-9 w-9"
                        >
                            <Sparkles className={`h-4 w-4 ${classifying ? 'animate-pulse' : ''}`} />
                        </Button>
                        <Button
                            variant="outline"
                            size="icon"
                            onClick={loadData}
                            disabled={loading}
                            title="刷新"
                            className="h-9 w-9"
                        >
                            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                        </Button>
                        <Button
                            size="sm"
                            onClick={() => setShowTimeCapsule(true)}
                            className="gap-1 bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700 text-white shadow-lg shadow-violet-500/30 h-9"
                        >
                            <Play className="h-4 w-4" />
                            时光胶囊
                        </Button>
                    </div>
                </div>
            </div>

            {/* 内容区域 */}
            <div className="flex-1 overflow-auto py-4">
                {/* 生产力热力图 */}
                <ProductivityHeatmap
                    selectedDate={selectedDate}
                    onDateSelect={setSelectedDate}
                />

                {/* 统计卡片 */}
                <div className="grid grid-cols-3 gap-4 mb-6">
                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-medium text-zinc-500 flex items-center gap-2">
                                <Clock className="h-4 w-4" />
                                今日总时长
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <p className="text-2xl font-bold">{formatDuration(totalDuration)}</p>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-medium text-zinc-500 flex items-center gap-2">
                                <Monitor className="h-4 w-4" />
                                使用应用数
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <p className="text-2xl font-bold">{appCount} 个</p>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-medium text-zinc-500 flex items-center gap-2">
                                <TrendingUp className="h-4 w-4" />
                                活动记录数
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <p className="text-2xl font-bold">{totalCount} 条</p>
                        </CardContent>
                    </Card>
                </div>

                {loading && stats.length === 0 ? (
                    <div className="flex items-center justify-center h-60 text-zinc-500">
                        <RefreshCw className="h-5 w-5 mr-2 animate-spin" />
                        加载中...
                    </div>
                ) : stats.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-60 text-zinc-500">
                        <Clock className="h-12 w-12 mb-4 opacity-30" />
                        <p>暂无活动数据</p>
                        <p className="text-sm mt-1">应用将自动追踪你的窗口使用情况</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-2 gap-6">
                        {/* 饼图 */}
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base">时间分布</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="h-80">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <PieChart>
                                            <Pie
                                                data={stats.slice(0, 10).map(s => ({ ...s, name: s.appName, value: s.totalDuration }))}
                                                cx="50%"
                                                cy="50%"
                                                innerRadius={60}
                                                outerRadius={100}
                                                paddingAngle={2}
                                                dataKey="value"
                                                nameKey="name"
                                                label={({ name, payload }) => `${name} ${payload.percentage}%`}
                                                labelLine={false}
                                            >
                                                {stats.slice(0, 10).map((_, index) => (
                                                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                                ))}
                                            </Pie>
                                            <Tooltip content={<CustomTooltip />} />
                                            <Legend />
                                        </PieChart>
                                    </ResponsiveContainer>
                                </div>
                            </CardContent>
                        </Card>

                        {/* 应用列表 */}
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base">Top 应用</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-3 max-h-80 overflow-auto">
                                    {stats.slice(0, 10).map((stat, index) => (
                                        <div key={stat.appName} className="flex items-center gap-3">
                                            <div
                                                className="w-3 h-3 rounded-full shrink-0"
                                                style={{ backgroundColor: COLORS[index % COLORS.length] }}
                                            />
                                            <div className="flex-1 min-w-0">
                                                <p className="font-medium truncate">{stat.appName}</p>
                                                <p className="text-sm text-zinc-500">
                                                    {formatDuration(stat.totalDuration)}
                                                </p>
                                            </div>
                                            <div className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                                                {stat.percentage}%
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                )}

                {/* 时间轴 */}
                <Card className="mt-6">
                    <CardHeader>
                        <CardTitle className="text-base flex items-center gap-2">
                            <CalendarDays className="h-4 w-4" />
                            今日活动时间轴
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="relative space-y-4">
                        {/* 缩放控制器 */}
                        <div className="flex items-center gap-4 bg-zinc-50 dark:bg-zinc-900/50 p-2 rounded-lg border border-dashed">
                            <div className="flex items-center gap-2 text-xs text-zinc-500 min-w-fit">
                                <SearchX className="h-3 w-3" />
                                视图范围
                            </div>
                            <Slider
                                value={viewRange}
                                onValueChange={(val) => setViewRange(val as [number, number])}
                                max={100}
                                step={0.1}
                                minStepsBetweenThumbs={1}
                                className="flex-1"
                            />
                            <div className="flex items-center gap-1">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 text-[10px]"
                                    onClick={() => setViewRange([0, 100])}
                                >
                                    重置
                                </Button>
                            </div>
                        </div>

                        {/* 时间轴可视化 */}
                        <div className="relative h-24 w-full bg-zinc-100 dark:bg-zinc-800 rounded-xl overflow-hidden shadow-inner flex items-center px-1">
                            {timelineData.map((block, index) => {
                                const startOfDay = new Date(block.startTime).setHours(0, 0, 0, 0)
                                const relativeStart = (block.startTime - startOfDay) / 1000
                                const originalLeft = (relativeStart / totalDaySeconds) * 100
                                const originalWidth = (block.duration / totalDaySeconds) * 100

                                // 根据 viewRange 重新计算
                                const zoomFactor = 100 / (viewRange[1] - viewRange[0])
                                const left = (originalLeft - viewRange[0]) * zoomFactor
                                const width = originalWidth * zoomFactor

                                // 仅渲染可见区域内的块
                                if (left + width < 0 || left > 100) return null
                                if (width < 0.01) return null // 过滤极小块提高性能

                                const config = CATEGORY_CONFIG[block.category] || CATEGORY_CONFIG.other
                                const color = getAppColor(block.appName, block.category)

                                return (
                                    <div
                                        key={block.startTime + '-' + index}
                                        className="absolute top-2 bottom-2 rounded-[2px] transition-all cursor-crosshair mix-blend-multiply dark:mix-blend-screen hover:z-50 hover:scale-y-110"
                                        style={{
                                            left: `${left}%`,
                                            width: `${width}%`,
                                            backgroundColor: color,
                                            opacity: 0.9,
                                        }}
                                        onMouseEnter={(e) => {
                                            setHoveredBlock({ ...block, config, color })
                                            setHoverPos({ x: e.clientX, y: e.clientY })

                                            // 加载缩略图
                                            if (visualRecallEnabled && window.api.visualRecall) {
                                                setLoadingThumbnail(true)
                                                setHoverThumbnail(null)
                                                // 查找该时间段内的快照
                                                // 稍微扩大一点搜索范围 (+- 5秒)
                                                window.api.visualRecall.searchSnapshots({
                                                    startTime: block.startTime - 5000,
                                                    endTime: block.endTime + 5000,
                                                    limit: 1
                                                }).then(res => {
                                                    if (res.snapshots && res.snapshots.length > 0) {
                                                        const snapshot = res.snapshots[0]
                                                        if (snapshot.has_image) {
                                                            // searchSnapshots 的 IPC 返回值里带上 base URL 或者完整 Image URL。
                                                            // main/index.ts 已经处理了 imageUrl 的注入
                                                            if (snapshot.imageUrl) {
                                                                setHoverThumbnail(snapshot.imageUrl)
                                                            }
                                                        }
                                                    }
                                                }).finally(() => {
                                                    setLoadingThumbnail(false)
                                                })
                                            }
                                        }}
                                        onMouseMove={(e) => {
                                            setHoverPos({ x: e.clientX, y: e.clientY })
                                        }}
                                        onMouseLeave={() => {
                                            setHoveredBlock(null)
                                            setHoverThumbnail(null)
                                        }}
                                    />
                                )
                            })}
                        </div>

                        {/* 动态时间刻度 */}
                        <div className="flex justify-between text-[10px] tabular-nums text-zinc-400 px-1 font-medium">
                            {Array.from({ length: 9 }).map((_, i) => {
                                const percent = viewRange[0] + (i / 8) * (viewRange[1] - viewRange[0])
                                const seconds = (percent / 100) * 24 * 3600
                                const h = Math.floor(seconds / 3600)
                                const m = Math.floor((seconds % 3600) / 60)
                                return (
                                    <span key={i}>
                                        {String(h).padStart(2, '0')}:{String(m).padStart(2, '0')}
                                    </span>
                                )
                            })}
                        </div>

                        {/* 即时显示的浮动提示层 */}
                        {hoveredBlock && (() => {
                            // 计算 tooltip 位置，避免超出右边界
                            const tooltipWidth = 280 // 预估 tooltip 宽度
                            const windowWidth = window.innerWidth
                            const isNearRightEdge = hoverPos.x + tooltipWidth + 40 > windowWidth
                            const left = isNearRightEdge
                                ? hoverPos.x - tooltipWidth - 20
                                : hoverPos.x + 20

                            return (
                                <div
                                    className="fixed z-[100] pointer-events-none bg-white/95 dark:bg-zinc-900/95 backdrop-blur-md border rounded-xl shadow-2xl p-4 min-w-[240px] max-w-[280px] animate-in fade-in zoom-in duration-150"
                                    style={{
                                        left,
                                        top: hoverPos.y + 20
                                    }}
                                >
                                    <div className="flex items-center gap-2 mb-3">
                                        <span className="text-xl">{hoveredBlock.config.icon}</span>
                                        <span
                                            className="px-3 py-1 rounded-full text-[10px] font-bold text-white uppercase tracking-wider"
                                            style={{ backgroundColor: hoveredBlock.color }}
                                        >
                                            {hoveredBlock.config.name}
                                        </span>
                                    </div>
                                    <p className="font-bold text-sm text-zinc-900 dark:text-zinc-100 mb-1 leading-tight">{hoveredBlock.appName}</p>
                                    <p className="text-xs text-zinc-500 mb-4 line-clamp-2 max-w-[280px]">{hoveredBlock.windowTitle}</p>

                                    {visualRecallEnabled && (
                                        <div className="mb-4 bg-zinc-100 dark:bg-zinc-800 rounded-lg overflow-hidden h-32 flex items-center justify-center relative">
                                            {loadingThumbnail ? (
                                                <RefreshCw className="h-5 w-5 text-zinc-400 animate-spin" />
                                            ) : hoverThumbnail ? (
                                                <img
                                                    src={hoverThumbnail}
                                                    className="w-full h-full object-cover"
                                                    alt="Snapshot"
                                                    onError={(e) => {
                                                        (e.target as HTMLImageElement).style.display = 'none'
                                                    }}
                                                />
                                            ) : (
                                                <div className="flex flex-col items-center justify-center text-zinc-400 gap-1">
                                                    <EyeOff className="h-5 w-5" />
                                                    <span className="text-[10px]">无视觉记录</span>
                                                </div>
                                            )}
                                            {/* 遮罩显示 OCR 文本提示？暂不加 */}
                                        </div>
                                    )}

                                    <div className="flex justify-between items-center text-[10px] font-bold text-zinc-400 border-t border-zinc-100 dark:border-zinc-800 pt-3">
                                        <div className="flex items-center gap-1">
                                            <Clock className="h-3 w-3" />
                                            {formatTime(hoveredBlock.startTime)} - {formatTime(hoveredBlock.endTime)}
                                        </div>
                                        <div className="text-primary bg-primary/10 px-2 py-1 rounded">
                                            {formatDuration(hoveredBlock.duration)}
                                        </div>
                                    </div>
                                </div>
                            )
                        })()}
                    </CardContent>
                </Card>
                {/* 分类统计 */}
                {categoryStats.length > 0 && (
                    <div className="grid grid-cols-2 gap-6 mt-6">
                        {/* 分类列表 */}
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base">按类别统计</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-3">
                                    {categoryStats.map(stat => {
                                        const config = CATEGORY_CONFIG[stat.category] || CATEGORY_CONFIG.other
                                        return (
                                            <div key={stat.category} className="flex items-center gap-3">
                                                <div
                                                    className="w-8 h-8 rounded-lg flex items-center justify-center text-lg shrink-0"
                                                    style={{ backgroundColor: config.color + '20' }}
                                                >
                                                    {config.icon}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <p className="font-medium">{config.name}</p>
                                                    <div className="flex items-center gap-2">
                                                        <div className="flex-1 bg-zinc-200 dark:bg-zinc-700 rounded-full h-2">
                                                            <div
                                                                className="h-2 rounded-full"
                                                                style={{
                                                                    width: `${stat.percentage}%`,
                                                                    backgroundColor: config.color
                                                                }}
                                                            />
                                                        </div>
                                                        <span className="text-xs text-zinc-500 w-10">
                                                            {stat.percentage}%
                                                        </span>
                                                    </div>
                                                </div>
                                                <div className="text-sm text-zinc-500 shrink-0">
                                                    {formatDuration(stat.totalDuration)}
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            </CardContent>
                        </Card>

                        {/* 项目列表 */}
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base flex items-center gap-2">
                                    <FolderOpen className="h-4 w-4" />
                                    按项目统计
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                {projectStats.length > 0 ? (
                                    <div className="space-y-3">
                                        {projectStats.map((stat, index) => (
                                            <div key={stat.projectName} className="flex items-center gap-3">
                                                <div
                                                    className="w-3 h-3 rounded-full shrink-0"
                                                    style={{ backgroundColor: COLORS[index % COLORS.length] }}
                                                />
                                                <div className="flex-1 min-w-0">
                                                    <p className="font-medium truncate">{stat.projectName}</p>
                                                    <p className="text-sm text-zinc-500">
                                                        {formatDuration(stat.totalDuration)}
                                                    </p>
                                                </div>
                                                <div className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                                                    {stat.percentage}%
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="text-sm text-zinc-500 text-center py-4">
                                        点击"AI 分类"按钮识别项目
                                    </p>
                                )}
                            </CardContent>
                        </Card>
                    </div>
                )}

                {/* AI 总结 */}
                <Card className="mt-6">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-base flex items-center gap-2">
                            <FileText className="h-4 w-4" />
                            AI 智能总结
                        </CardTitle>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleGenerateSummary}
                            disabled={generatingSummary}
                            className="text-primary hover:text-primary/90"
                        >
                            {generatingSummary ? (
                                <>
                                    <RefreshCw className="h-3 w-3 mr-1 animate-spin" />
                                    生成中...
                                </>
                            ) : (
                                <>
                                    <Sparkles className="h-3 w-3 mr-1" />
                                    生成日报
                                </>
                            )}
                        </Button>
                    </CardHeader>
                    <CardContent>
                        {summary ? (
                            <div className="prose prose-sm dark:prose-invert max-w-none bg-zinc-50/50 dark:bg-zinc-900/50 p-4 rounded-lg">
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>{summary}</ReactMarkdown>
                            </div>
                        ) : (
                            <div className="text-center py-8 text-zinc-500 text-sm">
                                点击"生成日报"按钮，让 AI 帮你总结一天的工作。
                            </div>
                        )}
                    </CardContent>
                </Card>


                {/* 活动日志 */}
                {logs.length > 0 && (
                    <Card className="mt-6">
                        <CardHeader>
                            <CardTitle className="text-base">最近活动</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-1 max-h-[500px] overflow-auto pr-2">
                                {logs.slice(0, 100).map(log => (
                                    <ActivityLogItem
                                        key={log.id}
                                        log={log}
                                        visualRecallEnabled={visualRecallEnabled}
                                    />
                                ))}
                            </div>
                            <div className="pt-2 mt-2 text-center border-t border-zinc-100 dark:border-zinc-800">
                                <Button
                                    variant="link"
                                    size="sm"
                                    onClick={() => setShowAllActivities(true)}
                                    className="text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-300"
                                >
                                    查看全部记录 <ChevronRight className="h-3 w-3 ml-1" />
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                )}
            </div>

            {/* Time Capsule 时光胶囊 */}
            <TimeCapsule
                isOpen={showTimeCapsule}
                onClose={() => setShowTimeCapsule(false)}
                date={selectedDate}
            />



            {/* All Activities Dialog */}
            <Dialog open={showAllActivities} onOpenChange={setShowAllActivities}>
                <DialogContent className="max-w-[90vw] max-h-[90vh] h-[90vh] flex flex-col p-0">
                    <DialogHeader className="p-4 border-b shrink-0">
                        <div className="flex items-center gap-4 pr-8">
                            <DialogTitle className="flex items-center gap-2 shrink-0">
                                <List className="h-5 w-5" />
                                全部活动记录 ({selectedDate})
                            </DialogTitle>
                            <div className="flex-1" />
                            <Input
                                placeholder="筛选应用或窗口标题..."
                                value={activityFilter}
                                onChange={(e) => setActivityFilter(e.target.value)}
                                className="w-48 h-8 text-sm"
                            />
                            <select
                                value={categoryFilter}
                                onChange={(e) => setCategoryFilter(e.target.value)}
                                className="h-8 px-2 text-sm border border-zinc-200 rounded-md bg-white dark:bg-zinc-900 dark:border-zinc-700"
                            >
                                <option value="all">全部类别</option>
                                {Object.entries(CATEGORY_CONFIG).map(([key, cfg]) => (
                                    <option key={key} value={key}>{cfg.icon} {cfg.name}</option>
                                ))}
                            </select>
                        </div>
                    </DialogHeader>
                    {/* 虚拟化列表实现 - 只渲染可见区域的行 */}
                    <VirtualizedActivityTable
                        logs={filteredLogs}
                        remarkEdits={remarkEdits}
                        setRemarkEdits={setRemarkEdits}
                        setLogs={setLogs}
                        formatDuration={formatDuration}
                    />
                    {logs.length === 0 && (
                        <div className="flex flex-col items-center justify-center py-12 text-zinc-400">
                            <SearchX className="h-10 w-10 mb-2 opacity-50" />
                            <p>当天无活动记录</p>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    )
}
