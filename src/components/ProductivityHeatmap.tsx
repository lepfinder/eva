/**
 * 生产力热力图组件
 * GitHub 风格的日历热力图，展示最近 1 年（过去 52 周滚动）的生产力趋势与月份刻度
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { Calendar, Clock, Sparkles } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip'

// 热力图数据点类型
interface HeatmapDataPoint {
    date: string      // YYYY-MM-DD
    total: number     // 总时长（秒）
    hue: string       // 色调：violet/orange/indigo
    score: number     // 生产力分数 (0-100)
}

interface ProductivityHeatmapProps {
    selectedDate: string
    onDateSelect: (date: string) => void
}

// 格式化时长
function formatDuration(seconds: number): string {
    if (seconds < 60) return `${seconds}秒`
    if (seconds < 3600) return `${Math.floor(seconds / 60)}分钟`
    const hours = Math.floor(seconds / 3600)
    const mins = Math.floor((seconds % 3600) / 60)
    return mins > 0 ? `${hours}小时${mins}分` : `${hours}小时`
}

// 获取有活动记录时的格子颜色
function getCellActiveColor(data: HeatmapDataPoint | undefined): string | undefined {
    if (!data || data.total === 0) return undefined

    // 计算透明度 (8小时 = 100%)
    const alpha = Math.min(data.total / (8 * 3600), 1)
    const opacity = 0.35 + alpha * 0.65

    // 根据色调返回颜色
    const hue = data.hue || 'indigo'
    const colors: Record<string, string> = {
        violet: `rgba(139, 92, 246, ${opacity})`,  // 紫色 - 核心开发/工作
        orange: `rgba(249, 115, 22, ${opacity})`,  // 橙色 - 分心娱乐
        indigo: `rgba(99, 102, 241, ${opacity})`   // 靛蓝 - 默认综合
    }

    return colors[hue] || colors.indigo
}

// 获取滚动最近 1 年（53 周）的完整周数据，最右侧一周对应当前本周
function getRolling52Weeks(): { date: Date; dateStr: string }[][] {
    const weeks: { date: Date; dateStr: string }[][] = []
    const now = new Date()

    // 找到本周的周日作为结束边界
    const dayOfWeek = now.getDay() // 0 是周日, 1 是周一...
    const daysUntilSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek
    const currentWeekSunday = new Date(now)
    currentWeekSunday.setDate(now.getDate() + daysUntilSunday)
    currentWeekSunday.setHours(23, 59, 59, 999)

    // 往前推 53 周（53 * 7 = 371 天，确保最左侧周一到最右侧周日完整覆盖 53 列）
    const startDate = new Date(currentWeekSunday)
    startDate.setDate(currentWeekSunday.getDate() - (53 * 7 - 1))
    startDate.setHours(0, 0, 0, 0)

    const curr = new Date(startDate)
    for (let w = 0; w < 53; w++) {
        const week: { date: Date; dateStr: string }[] = []
        for (let d = 0; d < 7; d++) {
            const dt = new Date(curr)
            week.push({
                date: dt,
                dateStr: `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
            })
            curr.setDate(curr.getDate() + 1)
        }
        weeks.push(week)
    }

    return weeks
}

export function ProductivityHeatmap({ selectedDate, onDateSelect }: ProductivityHeatmapProps) {
    const [heatmapData, setHeatmapData] = useState<HeatmapDataPoint[]>([])
    const [loading, setLoading] = useState(true)
    const scrollContainerRef = useRef<HTMLDivElement>(null)

    const today = useMemo(() => {
        const d = new Date()
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    }, [])

    // 滚动 53 周数据结构
    const displayWeeks = useMemo(() => getRolling52Weeks(), [])

    const startDateStr = displayWeeks[0]?.[0]?.dateStr || ''
    const endDateStr = displayWeeks[displayWeeks.length - 1]?.[6]?.dateStr || ''

    // 加载热力图数据（最近 1 年跨度）
    useEffect(() => {
        async function loadData() {
            try {
                setLoading(true)
                if (window.api?.activity?.rebuildDailyStats) {
                    await window.api.activity.rebuildDailyStats().catch(() => {})
                }
                const data = await window.api?.activity?.getHeatmapData({
                    startDate: startDateStr,
                    endDate: endDateStr,
                })
                setHeatmapData(data || [])
            } catch (error) {
                console.error('Failed to load heatmap data:', error)
            } finally {
                setLoading(false)
            }
        }
        if (startDateStr && endDateStr) {
            loadData()
        }
    }, [startDateStr, endDateStr])

    // 自动滚动到最右端（聚焦当前最新的一周）
    useEffect(() => {
        if (!loading && scrollContainerRef.current) {
            scrollContainerRef.current.scrollLeft = scrollContainerRef.current.scrollWidth
        }
    }, [loading])

    // 转换为 Map 方便按日期 O(1) 查找
    const dataMap = useMemo(() => {
        const map = new Map<string, HeatmapDataPoint>()
        heatmapData.forEach(d => map.set(d.date, d))
        return map
    }, [heatmapData])

    // 最近 1 年关键统计指标
    const stats = useMemo(() => {
        const activePoints = heatmapData.filter(d => d.total > 0)
        const totalSeconds = activePoints.reduce((acc, cur) => acc + cur.total, 0)
        const avgScore = activePoints.length > 0
            ? Math.round(activePoints.reduce((acc, cur) => acc + cur.score, 0) / activePoints.length)
            : 0

        return {
            activeDays: activePoints.length,
            totalHours: (totalSeconds / 3600).toFixed(1),
            avgScore,
        }
    }, [heatmapData])

    // 计算顶部月份轴标记（列对齐模式）
    const monthColumns = useMemo(() => {
        const map = new Map<number, string>()
        let lastMonth = -1
        let lastShownIdx = -99

        displayWeeks.forEach((week, idx) => {
            // 采用该周周四（或首日）的月份作为代表
            const refDate = week[3]?.date || week[0]?.date
            if (refDate) {
                const month = refDate.getMonth()
                if (month !== lastMonth && idx - lastShownIdx >= 2) {
                    map.set(idx, `${month + 1}月`)
                    lastMonth = month
                    lastShownIdx = idx
                }
            }
        })

        return map
    }, [displayWeeks])

    // 点击日期
    const handleDateClick = useCallback((dateStr: string) => {
        const todayDate = new Date()
        const clickedDate = new Date(dateStr)
        if (clickedDate <= todayDate) {
            onDateSelect(dateStr)
        }
    }, [onDateSelect])

    const weekDayLabels = ['一', '二', '三', '四', '五', '六', '日']

    return (
        <Card className="mb-6 shadow-sm border-border/70 bg-card">
            <CardContent className="p-4">
                {/* 顶部 Header & 控制栏 */}
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                            <Calendar className="h-4 w-4 text-primary" />
                            <span>生产力日历（最近 1 年）</span>
                        </div>
                        {loading ? (
                            <span className="text-xs text-muted-foreground animate-pulse">正在加载历史活动...</span>
                        ) : (
                            <div className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground">
                                <span className="inline-flex items-center gap-1">
                                    <Clock className="h-3 w-3 text-muted-foreground" />
                                    累计 {stats.totalHours} 小时
                                </span>
                                <span>•</span>
                                <span>活跃 {stats.activeDays} 天</span>
                                <span>•</span>
                                <span className="inline-flex items-center gap-1">
                                    <Sparkles className="h-3 w-3 text-amber-500" />
                                    平均生产力 {stats.avgScore} 分
                                </span>
                            </div>
                        )}
                    </div>

                    <div className="text-xs text-muted-foreground font-mono">
                        {startDateStr} ~ {today}
                    </div>
                </div>

                {/* 热力图网格（支持水平平滑滚动，默认贴紧最右侧最新日期） */}
                <div ref={scrollContainerRef} className="overflow-x-auto pb-1 scrollbar-thin">
                    <div className="inline-block min-w-max">
                        {/* 月份刻度轴（与下方周列严格像素级列对齐） */}
                        <div className="flex text-[11px] font-medium text-muted-foreground/80 mb-1 select-none">
                            <div className="w-5 shrink-0" />
                            <div className="flex gap-[3px]">
                                {displayWeeks.map((_, idx) => {
                                    const monthLabel = monthColumns.get(idx)
                                    return (
                                        <div key={idx} className="w-[12px] flex items-center justify-start relative overflow-visible h-4">
                                            {monthLabel && (
                                                <span className="absolute left-0 top-0 whitespace-nowrap text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
                                                    {monthLabel}
                                                </span>
                                            )}
                                        </div>
                                    )
                                })}
                            </div>
                        </div>

                        {/* 主体：星期轴 + 矩阵格子 */}
                        <div className="flex items-start">
                            {/* 星期 Y 轴（一/三/五/日） */}
                            <div className="flex flex-col gap-[3px] text-[10px] text-muted-foreground/70 pr-1.5 select-none w-5">
                                {weekDayLabels.map((day, idx) => (
                                    <div key={idx} className="h-[12px] flex items-center justify-end">
                                        {idx % 2 === 0 ? day : ''}
                                    </div>
                                ))}
                            </div>

                            {/* 日历格子列 */}
                            <div className="flex gap-[3px]">
                                <TooltipProvider delayDuration={50}>
                                    {displayWeeks.map((week, weekIdx) => (
                                        <div key={weekIdx} className="flex flex-col gap-[3px]">
                                            {week.map((day, dayIdx) => {
                                                const data = dataMap.get(day.dateStr)
                                                const hasActivity = !!(data && data.total > 0)
                                                const isToday = day.dateStr === today
                                                const isFuture = new Date(day.dateStr) > new Date()
                                                const isSelected = day.dateStr === selectedDate
                                                const activeColor = getCellActiveColor(data)

                                                return (
                                                    <Tooltip key={dayIdx}>
                                                        <TooltipTrigger asChild>
                                                            <button
                                                                type="button"
                                                                onClick={() => handleDateClick(day.dateStr)}
                                                                disabled={isFuture}
                                                                aria-label={`日期 ${day.dateStr}`}
                                                                className={`
                                                                    w-[12px] h-[12px] rounded-[2px] transition-all
                                                                    ${isFuture
                                                                        ? 'bg-zinc-100/50 dark:bg-zinc-800/20 cursor-not-allowed opacity-30'
                                                                        : hasActivity
                                                                            ? 'cursor-pointer hover:scale-125 hover:z-10'
                                                                            : 'bg-[#ebedf0] dark:bg-[#27272a] cursor-pointer hover:scale-110 hover:bg-zinc-300 dark:hover:bg-zinc-600'
                                                                    }
                                                                    ${isToday ? 'ring-2 ring-primary ring-offset-1 ring-offset-background z-10' : ''}
                                                                    ${isSelected && !isToday ? 'ring-2 ring-blue-500 ring-offset-1 ring-offset-background z-10' : ''}
                                                                `}
                                                                style={{
                                                                    backgroundColor: hasActivity ? activeColor : undefined
                                                                }}
                                                            />
                                                        </TooltipTrigger>
                                                        <TooltipContent side="top" className="text-xs p-2.5 space-y-1.5 shadow-xl bg-zinc-900 text-white border-zinc-800 z-50">
                                                            <div className="font-semibold flex items-center justify-between gap-3 border-b border-zinc-700/60 pb-1">
                                                                <span>{day.dateStr}</span>
                                                                {isToday && <span className="text-[10px] bg-primary/30 text-primary-foreground px-1.5 py-0.5 rounded font-normal">今天</span>}
                                                            </div>
                                                            {hasActivity ? (
                                                                <div className="space-y-1 text-zinc-300">
                                                                    <div className="flex items-center justify-between gap-3">
                                                                        <span className="text-zinc-400">记录时长:</span>
                                                                        <span className="font-mono font-medium text-white">{formatDuration(data.total)}</span>
                                                                    </div>
                                                                    <div className="flex items-center justify-between gap-3">
                                                                        <span className="text-zinc-400">生产力分数:</span>
                                                                        <span className="font-mono font-medium text-white">{Math.round(data.score)} 分</span>
                                                                    </div>
                                                                </div>
                                                            ) : (
                                                                <div className="text-zinc-400 text-[11px]">
                                                                    {isFuture ? '未来日期' : '无活动记录'}
                                                                </div>
                                                            )}
                                                        </TooltipContent>
                                                    </Tooltip>
                                                )
                                            })}
                                        </div>
                                    ))}
                                </TooltipProvider>
                            </div>
                        </div>
                    </div>
                </div>

                {/* 底部图例 & 标签 */}
                <div className="flex flex-wrap items-center justify-between gap-4 mt-3 pt-2.5 border-t border-border/40 text-[11px] text-muted-foreground select-none">
                    <div className="flex items-center gap-1.5">
                        <span>无活动</span>
                        <div
                            className="w-[11px] h-[11px] rounded-[2px] bg-[#ebedf0] dark:bg-[#27272a]"
                            title="无记录"
                        />
                        <span className="ml-2">少</span>
                        <div className="flex gap-[3px]">
                            {[0.35, 0.55, 0.75, 1.0].map((opacity, idx) => (
                                <div
                                    key={idx}
                                    className="w-[11px] h-[11px] rounded-[2px]"
                                    style={{ backgroundColor: `rgba(99, 102, 241, ${opacity})` }}
                                    title={`级别 ${idx + 1}`}
                                />
                            ))}
                        </div>
                        <span>多</span>
                    </div>

                    <div className="flex items-center gap-3">
                        <span className="inline-flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 rounded-[2px] bg-violet-500" />
                            <span>核心开发</span>
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 rounded-[2px] bg-orange-500" />
                            <span>分心/娱乐</span>
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 rounded-[2px] ring-1 ring-primary" />
                            <span>今日聚焦</span>
                        </span>
                    </div>
                </div>
            </CardContent>
        </Card>
    )
}
