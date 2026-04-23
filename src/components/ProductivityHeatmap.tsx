/**
 * 生产力热力图组件
 * GitHub 风格的日历热力图，展示每日生产力趋势
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import { ChevronDown, ChevronUp, Calendar } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip'

// 热力图数据类型
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

// 获取格子颜色
function getCellColor(data: HeatmapDataPoint | undefined, isFuture: boolean): string {
    if (isFuture) return 'bg-zinc-100 dark:bg-zinc-800/30'
    if (!data || data.total === 0) return 'bg-zinc-200 dark:bg-zinc-700/50'

    // 计算透明度 (8小时 = 100%)
    const alpha = Math.min(data.total / (8 * 3600), 1)
    const opacity = 0.2 + alpha * 0.8

    // 根据色调返回颜色
    const hue = data.hue || 'indigo'
    const colors: Record<string, string> = {
        violet: `rgba(139, 92, 246, ${opacity})`,  // 紫色 - 开发类
        orange: `rgba(249, 115, 22, ${opacity})`,  // 橙色 - 分心类
        indigo: `rgba(99, 102, 241, ${opacity})`   // 靛蓝 - 默认
    }

    return colors[hue] || colors.indigo
}

// 获取一年中的所有周
function getYearWeeks(year: number): { date: Date; dateStr: string }[][] {
    const weeks: { date: Date; dateStr: string }[][] = []
    const startDate = new Date(year, 0, 1)

    // 找到第一周的周一
    const dayOfWeek = startDate.getDay()
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
    startDate.setDate(startDate.getDate() + mondayOffset)

    let currentDate = new Date(startDate)
    const endYear = year + 1

    while (currentDate.getFullYear() < endYear || (currentDate.getFullYear() === endYear && currentDate.getMonth() === 0 && currentDate.getDate() <= 7)) {
        const week: { date: Date; dateStr: string }[] = []
        for (let i = 0; i < 7; i++) {
            const d = new Date(currentDate)
            week.push({
                date: d,
                dateStr: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
            })
            currentDate.setDate(currentDate.getDate() + 1)
        }
        weeks.push(week)

        // 安全检查：限制最多 53 周
        if (weeks.length > 53) break
    }

    return weeks
}

export function ProductivityHeatmap({ selectedDate, onDateSelect }: ProductivityHeatmapProps) {
    const [expanded, setExpanded] = useState(false)
    const [heatmapData, setHeatmapData] = useState<HeatmapDataPoint[]>([])
    const [loading, setLoading] = useState(true)

    const today = useMemo(() => {
        const d = new Date()
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    }, [])

    const currentYear = new Date().getFullYear()

    // 加载热力图数据
    useEffect(() => {
        async function loadData() {
            try {
                setLoading(true)
                // 尝试重建缺失的数据
                await window.api.activity.rebuildDailyStats()
                // 加载热力图数据
                const data = await window.api.activity.getHeatmapData(currentYear)
                setHeatmapData(data)
            } catch (error) {
                console.error('Failed to load heatmap data:', error)
            } finally {
                setLoading(false)
            }
        }
        loadData()
    }, [currentYear])

    // 转换为 Map 方便查找
    const dataMap = useMemo(() => {
        const map = new Map<string, HeatmapDataPoint>()
        heatmapData.forEach(d => map.set(d.date, d))
        return map
    }, [heatmapData])

    // 获取所有周
    const allWeeks = useMemo(() => getYearWeeks(currentYear), [currentYear])

    // 展示的周数：折叠模式显示最近 13 周（约 3 个月），展开模式显示全年
    const displayWeeks = useMemo(() => {
        if (expanded) return allWeeks
        // 找到今天所在的周
        const todayWeekIdx = allWeeks.findIndex(week =>
            week.some(day => day.dateStr === today)
        )
        const startIdx = Math.max(0, todayWeekIdx - 12)
        return allWeeks.slice(startIdx, todayWeekIdx + 1)
    }, [allWeeks, expanded, today])

    // 点击日期
    const handleDateClick = useCallback((dateStr: string) => {
        const todayDate = new Date()
        const clickedDate = new Date(dateStr)
        if (clickedDate <= todayDate) {
            onDateSelect(dateStr)
        }
    }, [onDateSelect])

    const weekDays = ['一', '二', '三', '四', '五', '六', '日']

    return (
        <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 text-sm text-zinc-500">
                    <Calendar className="h-4 w-4" />
                    <span>生产力日历</span>
                    {loading && <span className="text-xs text-zinc-400">加载中...</span>}
                </div>
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setExpanded(!expanded)}
                    className="h-6 px-2 text-xs text-zinc-500 hover:text-zinc-700"
                >
                    {expanded ? (
                        <>收起 <ChevronUp className="h-3 w-3 ml-1" /></>
                    ) : (
                        <>展开全年 <ChevronDown className="h-3 w-3 ml-1" /></>
                    )}
                </Button>
            </div>

            <div className="flex gap-1">
                {/* 周一到周日标签 */}
                <div className="flex flex-col gap-[2px] text-[10px] text-zinc-400 pr-1 py-1">
                    {weekDays.map((day, idx) => (
                        <div key={idx} className="h-[12px] flex items-center justify-end">
                            {idx % 2 === 0 ? day : ''}
                        </div>
                    ))}
                </div>

                {/* 热力图格子 */}
                <div className="flex gap-[2px] overflow-x-auto p-1">
                    <TooltipProvider delayDuration={100}>
                        {displayWeeks.map((week, weekIdx) => (
                            <div key={weekIdx} className="flex flex-col gap-[2px]">
                                {week.map((day, dayIdx) => {
                                    const data = dataMap.get(day.dateStr)
                                    const isToday = day.dateStr === today
                                    const isFuture = new Date(day.dateStr) > new Date()
                                    const isSelected = day.dateStr === selectedDate

                                    return (
                                        <Tooltip key={dayIdx}>
                                            <TooltipTrigger asChild>
                                                <button
                                                    onClick={() => handleDateClick(day.dateStr)}
                                                    disabled={isFuture}
                                                    className={`
                            w-[12px] h-[12px] rounded-[2px] transition-all
                            ${isFuture ? 'cursor-default opacity-30' : 'cursor-pointer hover:scale-110'}
                            ${isToday ? 'ring-1 ring-violet-400 animate-pulse' : ''}
                            ${isSelected ? 'ring-2 ring-violet-500' : ''}
                          `}
                                                    style={{
                                                        backgroundColor: getCellColor(data, isFuture)
                                                    }}
                                                />
                                            </TooltipTrigger>
                                            <TooltipContent side="top" className="text-xs">
                                                <div className="font-medium">{day.dateStr}</div>
                                                {data ? (
                                                    <>
                                                        <div>时长: {formatDuration(data.total)}</div>
                                                        <div>生产力: {data.score}分</div>
                                                    </>
                                                ) : (
                                                    <div className="text-zinc-400">{isFuture ? '未来日期' : '无数据'}</div>
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

            {/* 图例 */}
            <div className="flex items-center gap-4 mt-2 text-[10px] text-zinc-400">
                <span>少</span>
                <div className="flex gap-[2px]">
                    {[0.2, 0.4, 0.6, 0.8, 1].map((opacity, idx) => (
                        <div
                            key={idx}
                            className="w-[10px] h-[10px] rounded-[2px]"
                            style={{ backgroundColor: `rgba(99, 102, 241, ${opacity})` }}
                        />
                    ))}
                </div>
                <span>多</span>
                <span className="ml-4">
                    <span className="inline-block w-[10px] h-[10px] rounded-[2px] mr-1" style={{ backgroundColor: 'rgba(139, 92, 246, 0.8)' }} />
                    开发
                </span>
                <span>
                    <span className="inline-block w-[10px] h-[10px] rounded-[2px] mr-1" style={{ backgroundColor: 'rgba(249, 115, 22, 0.8)' }} />
                    分心
                </span>
            </div>
        </div>
    )
}
