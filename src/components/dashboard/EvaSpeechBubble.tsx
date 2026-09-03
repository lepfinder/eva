import React, { useState, useEffect, useCallback, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { getActiveAiConfig } from '@/components/AiProviderSettings'
import { Sparkles, RefreshCw, Activity } from 'lucide-react'

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

const CACHE_KEY = 'eva_companion_speech_cache_v1'
const CACHE_TIME_KEY = 'eva_companion_speech_time_v1'
const CACHE_TTL_MS = 45 * 60 * 1000 // 45 分钟缓存过期

export function EvaSpeechBubble(): React.ReactElement {
    const [message, setMessage] = useState<string>('')
    const [loading, setLoading] = useState(false)
    const [hovered, setHovered] = useState(false)
    const hasFetchedRef = useRef(false)

    // 本地启发式智能模板生成（无大模型 API Key 时的客观专业保底）
    const generateLocalFallback = useCallback((totalSecs: number, topProject?: string, topCategory?: string) => {
        const hour = new Date().getHours()
        const hoursWorked = (totalSecs / 3600).toFixed(1)

        if (hour >= 23 || hour < 5) {
            return `当前已进入深夜时段，今日累计活跃 ${hoursWorked} 小时。核心代码任务已就绪，注意保存工作进度。`
        } else if (hour >= 18) {
            if (topProject && topProject !== 'Unknown') {
                return `晚间时段，今日主要精力集中在「${topProject}」模块。整体进度平稳推进中。`
            }
            return `今日已完成 ${hoursWorked} 小时工作量。各项本地开发与后台服务运行正常。`
        } else if (hour >= 12 && hour < 14) {
            return `午间时段，上午活跃峰值处于开发与协作阶段，准备开启下半场任务。`
        } else if (hour >= 5 && hour < 9) {
            return `早晨好。本地运行环境与监控服务已全部挂载就绪，随时可展开工程调试。`
        } else {
            if (totalSecs > 3 * 3600 && topProject) {
                return `「${topProject}」今日已连续投入 ${hoursWorked} 小时，处于高密度产出状态。`
            } else if (topCategory === 'communication') {
                return `今日沟通协作占比较高，相关待办与决议建议同步归档至记录中。`
            }
            return `系统与后台活动监听正常，今日开发与日常任务正有序推进。`
        }
    }, [])

    // 智能感知生成（结合真实数据与大模型）
    const fetchCompanionSpeech = useCallback(async (force = false) => {
        try {
            // 1. 尝试读缓存
            if (!force) {
                const cached = localStorage.getItem(CACHE_KEY)
                const cacheTime = localStorage.getItem(CACHE_TIME_KEY)
                if (cached && cacheTime && Date.now() - Number(cacheTime) < CACHE_TTL_MS) {
                    setMessage(cached)
                    return
                }
            }

            // 2. 抓取今日全天统计与最近活动微观上下文
            let totalSecs = 0
            let categories: CategoryStat[] = []
            let projects: ProjectStat[] = []
            let recentLogs: ActivityLog[] = []

            try {
                const [dur, cats, projs, logs] = await Promise.all([
                    invoke<number>('activity_get_today_total_duration').catch(() => 0),
                    invoke<CategoryStat[]>('activity_get_stats_by_category').catch(() => []),
                    invoke<ProjectStat[]>('activity_get_stats_by_project').catch(() => []),
                    invoke<ActivityLog[]>('activity_get_today_logs').catch(() => [])
                ])
                totalSecs = dur
                categories = cats
                projects = projs
                recentLogs = logs
            } catch (e) {
                console.warn('Failed to fetch activity stats for Eva speech:', e)
            }

            // 提炼全天画像
            const workHours = (totalSecs / 3600).toFixed(1)
            const catSummary = categories
                .slice(0, 3)
                .map(c => `${c.category}(${c.percentage}%, ${(c.totalDuration / 60).toFixed(0)}m)`)
                .join('、')
            const projSummary = projects
                .filter(p => p.projectName && p.projectName !== 'Unknown')
                .slice(0, 3)
                .map(p => `${p.projectName}(${(p.totalDuration / 3600).toFixed(1)}h)`)
                .join('、')

            // 提炼最近微观活动 (最近 15~30 分钟正在操作的具体应用和窗口文件)
            const recentSamples: string[] = []
            const seenTitles = new Set<string>()
            for (let i = recentLogs.length - 1; i >= 0 && recentSamples.length < 4; i--) {
                const item = recentLogs[i]
                if (item && item.windowTitle && !seenTitles.has(item.windowTitle)) {
                    seenTitles.add(item.windowTitle)
                    recentSamples.push(`${item.appName}: "${item.windowTitle}"`)
                }
            }
            const recentActivityDesc = recentSamples.length > 0 ? recentSamples.join(' | ') : '暂无明显窗口记录'

            // 3. 检查是否有 AI 配置
            const aiCfg = getActiveAiConfig()
            if (!aiCfg) {
                const fallback = generateLocalFallback(totalSecs, projects[0]?.projectName, categories[0]?.category)
                setMessage(fallback)
                localStorage.setItem(CACHE_KEY, fallback)
                localStorage.setItem(CACHE_TIME_KEY, String(Date.now()))
                return
            }

            // 4. 调用 LLM 进行精准的智能副驾分析与状态洞察
            setLoading(true)
            const hour = new Date().getHours()
            const timeDesc = hour < 6 ? '深夜' : hour < 12 ? '上午' : hour < 14 ? '中午' : hour < 18 ? '下午' : '夜晚'

            const prompt = `你是 EVA，运行在开发者 macOS 本地的个人数字智能体（Local Intelligence Agent）。
你的定位是：专业、敏锐、理性、懂软件工程细节的技术副驾（Co-pilot / Assistant）。

【绝对禁忌】
- 严禁任何暧昧、女友感或情感依恋口吻（绝不要出现“我陪你”、“歇歇吧宝贝”、“听话早点睡”等）；
- 严禁居高临下说教，不要生硬背诵枯燥数字。

【开发者今日全天与当前真实上下文】
1. 当前时间：${timeDesc} ${hour}点
2. 今日屏幕活跃总时长：${workHours} 小时
3. 全天主导领域与分布：${catSummary || '未充分归类'}
4. 正在投入的核心工程：${projSummary || '无特定工程'}
5. 最近正在具体操作的应用与代码文件/窗口：${recentActivityDesc}

【任务要求】
请结合上述开发者的真实工程与最近正在编辑的具体上下文，给出 1 句 25 到 45 个字以内、极具在场感与技术洞察力的工作状态提示或进度梳理。
语气要求：干练、专业、懂代码与开发节奏，像身边并肩作战的技术搭档。
直接输出这短短的一句话，不要加任何引号或格式前缀。`

            const data = await window.api.ai.chatCompletion({
                baseUrl: aiCfg.config.baseUrl,
                apiKey: aiCfg.config.apiKey,
                model: aiCfg.config.model,
                messages: [{ role: 'user', content: prompt }],
                maxTokens: 100,
                temperature: 0.6,
            })

            const speech = (data.choices?.[0]?.message?.content || '').trim().replace(/^["'“”]+|["'“”]+$/g, '')
            if (speech) {
                setMessage(speech)
                localStorage.setItem(CACHE_KEY, speech)
                localStorage.setItem(CACHE_TIME_KEY, String(Date.now()))
            } else {
                setMessage(generateLocalFallback(totalSecs, projects[0]?.projectName, categories[0]?.category))
            }
        } catch (err) {
            console.error('Failed to generate AI speech for Eva:', err)
            setMessage(generateLocalFallback(0))
        } finally {
            setLoading(false)
        }
    }, [generateLocalFallback])

    useEffect(() => {
        if (!hasFetchedRef.current) {
            hasFetchedRef.current = true
            fetchCompanionSpeech(false)
        }
    }, [fetchCompanionSpeech])

    if (!message) return <></>

    return (
        <div 
            className="group relative pointer-events-auto w-[280px] xl:w-[310px] transition-all duration-300 animate-in fade-in slide-in-from-bottom-2"
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
        >
            {/* 对话气泡主体 */}
            <div 
                className="relative rounded-2xl p-3.5 sm:p-4 shadow-[0_10px_35px_rgba(0,0,0,0.06)] dark:shadow-[0_12px_40px_rgba(0,0,0,0.45)] border border-white/70 dark:border-white/10 transition-all duration-300 hover:border-violet-300/60 dark:hover:border-violet-700/50 hover:shadow-[0_14px_45px_rgba(139,92,246,0.12)]"
                style={{
                    background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.88) 0%, rgba(248, 250, 252, 0.78) 100%)',
                    backdropFilter: 'blur(20px)',
                    WebkitBackdropFilter: 'blur(20px)',
                }}
            >
                {/* 顶部标识条 */}
                <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-1.5">
                        <span className="flex h-2 w-2 rounded-full bg-violet-500 shadow-[0_0_8px_rgba(139,92,246,0.6)] animate-pulse" />
                        <span className="text-[11px] font-semibold tracking-wider text-violet-600 dark:text-violet-400 flex items-center gap-1">
                            <Activity className="h-3 w-3 inline" />
                            EVA · 状态洞察
                        </span>
                    </div>

                    {/* 换一句按钮 */}
                    <button
                        onClick={() => fetchCompanionSpeech(true)}
                        disabled={loading}
                        className={`text-[11px] text-zinc-400 hover:text-violet-600 dark:hover:text-violet-300 flex items-center gap-1 px-1.5 py-0.5 rounded-md hover:bg-violet-50 dark:hover:bg-violet-950/40 transition-all ${hovered ? 'opacity-100' : 'opacity-70'}`}
                        title="点击让 EVA 重新感知并换一句"
                    >
                        <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin text-violet-500' : ''}`} />
                        <span>换一句</span>
                    </button>
                </div>

                {/* 动态内容正文 */}
                <p className="text-[13px] text-zinc-700 dark:text-zinc-200 leading-relaxed font-normal select-none">
                    {loading ? (
                        <span className="inline-flex items-center gap-1.5 text-zinc-400 animate-pulse text-xs">
                            <Sparkles className="h-3.5 w-3.5 text-violet-400 animate-spin" />
                            EVA 正在观察你的专注状态...
                        </span>
                    ) : (
                        message
                    )}
                </p>

                {/* 气泡小尾巴 (指向左下方的 EVA 头侧) */}
                <div 
                    className="absolute -bottom-1.5 left-8 w-3.5 h-3.5 rotate-45 border-r border-b border-white/70 dark:border-white/10"
                    style={{
                        background: 'rgba(255, 255, 255, 0.85)',
                        backdropFilter: 'blur(20px)',
                    }}
                />
            </div>
        </div>
    )
}
