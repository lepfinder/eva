import { useState, useEffect } from 'react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

interface ActivityLog {
    startTime: number
    endTime: number
    category?: string
}

interface HourData {
    hour: number
    category: string
    count: number
    duration: number
}

const CATEGORY_COLORS: Record<string, string> = {
    development: '#10B981', // 绿色
    communication: '#3B82F6', // 蓝色
    browsing: '#F59E0B', // 黄色
    productivity: '#8B5CF6', // 紫色
    entertainment: '#EC4899', // 粉色
    system: '#6B7280', // 灰色
    unclassified: '#D1D5DB', // 浅灰
    idle: '#E5E7EB' // 极浅灰
}

const CATEGORY_NAMES: Record<string, string> = {
    development: '开发',
    communication: '沟通',
    browsing: '浏览',
    productivity: '生产力',
    entertainment: '娱乐',
    system: '系统',
    unclassified: '其他',
    idle: '空闲'
}

export function TimePulseHeatmap(): React.ReactElement {
    const [hourlyData, setHourlyData] = useState<HourData[]>([])
    const [isLoading, setIsLoading] = useState(true)

    useEffect(() => {
        const loadData = async () => {
            try {
                const logs: ActivityLog[] = await window.api.activity.getTodayLogs()

                // 按小时聚合数据
                const hourMap = new Map<number, Map<string, number>>()

                // 初始化24小时
                for (let i = 0; i < 24; i++) {
                    hourMap.set(i, new Map())
                }

                // 统计每小时的活动
                logs.forEach(log => {
                    const startHour = new Date(log.startTime).getHours()
                    const category = log.category || 'unclassified'
                    const duration = log.endTime - log.startTime

                    // 简化处理：只统计开始小时
                    const categoryMap = hourMap.get(startHour)!
                    const current = categoryMap.get(category) || 0
                    categoryMap.set(category, current + duration)
                })

                // 转换为数组，每小时选择最主要的活动类型
                const result: HourData[] = []
                for (let hour = 0; hour < 24; hour++) {
                    const categoryMap = hourMap.get(hour)!

                    if (categoryMap.size === 0) {
                        result.push({ hour, category: 'idle', count: 0, duration: 0 })
                    } else {
                        // 找出持续时间最长的类别
                        let maxCategory = 'idle'
                        let maxDuration = 0

                        categoryMap.forEach((duration, category) => {
                            if (duration > maxDuration) {
                                maxDuration = duration
                                maxCategory = category
                            }
                        })

                        result.push({
                            hour,
                            category: maxCategory,
                            count: categoryMap.size,
                            duration: maxDuration
                        })
                    }
                }

                setHourlyData(result)
            } catch (error) {
                console.error('Failed to load activity data:', error)
            } finally {
                setIsLoading(false)
            }
        }

        loadData()
    }, [])

    if (isLoading) {
        return (
            <div className="flex items-center gap-2">
                <div className="text-sm text-zinc-500">加载中...</div>
            </div>
        )
    }

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-zinc-700">时间脉动</h3>
                <div className="text-xs text-zinc-500">24小时活动分布</div>
            </div>

            <TooltipProvider delayDuration={100}>
                <div className="flex gap-1">
                    {hourlyData.map((data, index) => (
                        <Tooltip key={data.hour}>
                            <TooltipTrigger asChild>
                                <div
                                    className="w-4 h-4 rounded-full cursor-pointer transition-transform hover:scale-125"
                                    style={{
                                        backgroundColor: CATEGORY_COLORS[data.category] || CATEGORY_COLORS.idle,
                                        opacity: data.duration > 0 ? 1 : 0.3,
                                        animationDelay: `${index * 30}ms`
                                    }}
                                />
                            </TooltipTrigger>
                            <TooltipContent>
                                <div className="text-xs">
                                    <div className="font-medium">{data.hour}:00 - {data.hour + 1}:00</div>
                                    <div className="text-zinc-400">
                                        {CATEGORY_NAMES[data.category] || '空闲'}
                                        {data.duration > 0 && ` · ${Math.round(data.duration / 1000 / 60)}分钟`}
                                    </div>
                                </div>
                            </TooltipContent>
                        </Tooltip>
                    ))}
                </div>
            </TooltipProvider>

            {/* 图例 */}
            <div className="flex flex-wrap gap-3 text-xs">
                {Object.entries(CATEGORY_NAMES).slice(0, 5).map(([key, name]) => (
                    <div key={key} className="flex items-center gap-1.5">
                        <div
                            className="w-2 h-2 rounded-full"
                            style={{ backgroundColor: CATEGORY_COLORS[key] }}
                        />
                        <span className="text-zinc-600">{name}</span>
                    </div>
                ))}
            </div>
        </div>
    )
}
