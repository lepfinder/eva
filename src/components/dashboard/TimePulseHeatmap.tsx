import React, { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Clock, TrendingUp, ChevronRight, FolderOpen, Zap } from 'lucide-react'

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

interface ActivityLog {
    startTime: number
    endTime: number
    category?: string
}

const CATEGORY_COLORS: Record<string, { name: string; color: string }> = {
    development:   { name: '开发', color: '#8b5cf6' },
    operations:    { name: '运维', color: '#ea580c' },
    communication: { name: '沟通', color: '#10b981' },
    writing:       { name: '写作', color: '#ec4899' },
    browsing:      { name: '浏览', color: '#06b6d4' },
    productivity:  { name: '效率', color: '#6366f1' },
    design:        { name: '设计', color: '#f43f5e' },
    entertainment: { name: '娱乐', color: '#f59e0b' },
    system:        { name: '系统', color: '#9ca3af' },
    distracted:    { name: '走神', color: '#64748b' },
    other:         { name: '其他', color: '#94a3b8' },
}

function formatDuration(seconds: number): string {
    if (seconds < 60) return `${seconds}秒`
    if (seconds < 3600) return `${Math.floor(seconds / 60)}分钟`
    const hours = Math.floor(seconds / 3600)
    const mins = Math.floor((seconds % 3600) / 60)
    return mins > 0 ? `${hours}小时${mins}分钟` : `${hours}小时`
}

export function TimePulseHeatmap(): React.ReactElement {
    const [totalSecs, setTotalSecs] = useState<number>(0)
    const [categories, setCategories] = useState<CategoryStat[]>([])
    const [topProject, setTopProject] = useState<string | null>(null)
    const [hourlyPulse, setHourlyPulse] = useState<string[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        const loadData = async () => {
            try {
                setLoading(true)
                const [dur, cats, projs, logs] = await Promise.all([
                    invoke<number>('activity_get_today_total_duration').catch(() => 0),
                    invoke<CategoryStat[]>('activity_get_stats_by_category').catch(() => []),
                    invoke<ProjectStat[]>('activity_get_stats_by_project').catch(() => []),
                    invoke<ActivityLog[]>('activity_get_today_logs').catch(() => [])
                ])

                setTotalSecs(dur)
                setCategories(cats)

                const validProj = projs.find(p => p.projectName && p.projectName !== 'Unknown')
                if (validProj) {
                    setTopProject(validProj.projectName)
                }

                // 24小时简练脉动分布
                const pulseMap = new Array(24).fill('#e2e8f0')
                const hourActivity: Record<number, Record<string, number>> = {}
                logs.forEach(l => {
                    const h = new Date(l.startTime).getHours()
                    if (!hourActivity[h]) hourActivity[h] = {}
                    const cat = l.category || 'other'
                    hourActivity[h][cat] = (hourActivity[h][cat] || 0) + (l.endTime - l.startTime)
                })

                for (let h = 0; h < 24; h++) {
                    const acts = hourActivity[h]
                    if (acts) {
                        let maxCat = 'other'
                        let maxDur = 0
                        for (const [cat, d] of Object.entries(acts)) {
                            if (d > maxDur) {
                                maxDur = d
                                maxCat = cat
                            }
                        }
                        if (maxDur > 60) {
                            pulseMap[h] = CATEGORY_COLORS[maxCat]?.color || '#8b5cf6'
                        }
                    }
                }
                setHourlyPulse(pulseMap)
            } catch (e) {
                console.error('Failed to load dashboard time stats:', e)
            } finally {
                setLoading(false)
            }
        }

        loadData()
    }, [])

    // 计算生产力得分
    const score = React.useMemo(() => {
        if (totalSecs <= 0) return 50
        const dev = categories.find(c => c.category === 'development')?.totalDuration || 0
        const writing = categories.find(c => c.category === 'writing')?.totalDuration || 0
        const ops = categories.find(c => c.category === 'operations')?.totalDuration || 0
        const distracted = categories.find(c => c.category === 'distracted')?.totalDuration || 0
        const prodRatio = (dev + writing + ops) / totalSecs
        const distRatio = distracted / totalSecs
        return Math.round(Math.max(0, Math.min(100, 50 + prodRatio * 50 - distRatio * 30)))
    }, [totalSecs, categories])

    // 跳转到时间审计页面
    const handleNavigate = () => {
        window.dispatchEvent(new CustomEvent('navigate-to-page', {
            detail: { page: 'timeauditor' }
        }))
    }

    return (
        <div 
            onClick={handleNavigate}
            className="cursor-pointer group select-none transition-all duration-300"
        >
            {/* 顶部指标速览 */}
            <div className="flex items-start justify-between mb-4">
                <div>
                    <div className="flex items-baseline gap-2">
                        <span className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100 group-hover:text-violet-600 dark:group-hover:text-violet-400 transition-colors">
                            {formatDuration(totalSecs)}
                        </span>
                        <span className="text-xs text-zinc-400 font-medium">
                            今日屏幕活跃
                        </span>
                    </div>

                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        {/* 生产力评分徽章 */}
                        <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-violet-50 dark:bg-violet-950/60 text-violet-600 dark:text-violet-300 border border-violet-200/60 dark:border-violet-800/40">
                            <Zap className="h-3 w-3 fill-violet-500" />
                            <span>{score}分 · {score >= 80 ? '高效专注' : score >= 60 ? '状态平稳' : '较为分散'}</span>
                        </div>

                        {/* 主力工程徽章 */}
                        {topProject && (
                            <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-200/70 dark:border-zinc-700/50 truncate max-w-[140px]">
                                <FolderOpen className="h-3 w-3 text-amber-500 shrink-0" />
                                <span className="truncate">{topProject}</span>
                            </div>
                        )}
                    </div>
                </div>

                <div className="flex items-center text-xs font-medium text-zinc-400 group-hover:text-violet-600 dark:group-hover:text-violet-400 transition-colors gap-0.5 pt-1">
                    <span>审计看板</span>
                    <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                </div>
            </div>

            {/* 紧凑多段彩色进度流 */}
            <div className="space-y-2.5">
                <div className="h-2.5 w-full bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden flex shadow-inner">
                    {categories.length > 0 ? (
                        categories.map(cat => {
                            const cfg = CATEGORY_COLORS[cat.category] || CATEGORY_COLORS.other
                            if (cat.percentage <= 0) return null
                            return (
                                <div
                                    key={cat.category}
                                    style={{
                                        width: `${cat.percentage}%`,
                                        backgroundColor: cfg.color
                                    }}
                                    className="h-full transition-all duration-500 first:rounded-l-full last:rounded-r-full"
                                    title={`${cfg.name}: ${formatDuration(cat.totalDuration)} (${cat.percentage}%)`}
                                />
                            )
                        })
                    ) : (
                        <div className="h-full w-full bg-zinc-200 dark:bg-zinc-700 animate-pulse" />
                    )}
                </div>

                {/* 类别精细数据 (4列自适应整洁紧凑展示，避免文本被截断) */}
                <div className="grid grid-cols-4 gap-1.5 pt-0.5">
                    {categories.slice(0, 4).map(cat => {
                        const cfg = CATEGORY_COLORS[cat.category] || CATEGORY_COLORS.other
                        return (
                            <div 
                                key={cat.category} 
                                className="flex items-center justify-center gap-1 py-1 px-1 rounded-md bg-white/45 dark:bg-zinc-800/40 border border-white/60 dark:border-white/5 text-[11px] shadow-2xs whitespace-nowrap"
                            >
                                <span
                                    className="h-1.5 w-1.5 rounded-full shrink-0"
                                    style={{ backgroundColor: cfg.color }}
                                />
                                <span className="font-medium text-zinc-700 dark:text-zinc-300">{cfg.name}</span>
                                <span className="font-semibold text-zinc-500 dark:text-zinc-400 tabular-nums text-[10.5px]">{cat.percentage}%</span>
                            </div>
                        )
                    })}
                </div>
            </div>
        </div>
    )
}
