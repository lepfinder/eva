/**
 * Time Capsule (时光胶囊) - 生产力回放系统
 * 120fps 沉浸式时间轴可视化动画
 */

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'
import { TimelineCanvas, ActivityBlock } from './TimelineCanvas'
import { PlaybackControls } from './PlaybackControls'

// 活动日志类型
interface ActivityLog {
    id: string
    appName: string
    windowTitle: string
    startTime: number
    endTime: number
    duration: number
    category?: string
}

// 类别配色
const CATEGORY_COLORS: Record<string, { primary: string; glow: string }> = {
    development: { primary: '#8b5cf6', glow: '#a78bfa' },  // 紫色 - 开发
    communication: { primary: '#06b6d4', glow: '#22d3ee' }, // 青色 - 沟通
    browsing: { primary: '#3b82f6', glow: '#60a5fa' },      // 蓝色 - 浏览
    productivity: { primary: '#10b981', glow: '#34d399' },  // 绿色 - 生产力
    entertainment: { primary: '#f59e0b', glow: '#fbbf24' }, // 琥珀色 - 娱乐
    system: { primary: '#6b7280', glow: '#9ca3af' },        // 灰色 - 系统
    unclassified: { primary: '#64748b', glow: '#94a3b8' },  // 石板灰 - 未分类
}

interface TimeCapsuleProps {
    isOpen: boolean
    onClose: () => void
    date?: string // YYYY-MM-DD 格式
}

export function TimeCapsule({ isOpen, onClose, date }: TimeCapsuleProps): React.ReactElement | null {
    // 播放状态
    const [isPlaying, setIsPlaying] = useState(false)
    const [playbackSpeed, setPlaybackSpeed] = useState(4) // 默认 4x
    const [currentTime, setCurrentTime] = useState(0) // 当前播放时间（秒，从当日 0 点开始）

    // 数据状态
    const [activities, setActivities] = useState<ActivityBlock[]>([])
    const [timeRange, setTimeRange] = useState({ start: 0, end: 86400 }) // 秒
    const [startOfDayTimestamp, setStartOfDayTimestamp] = useState(0) // 保存当天0点的时间戳
    const [isLoading, setIsLoading] = useState(true)

    // 当前激活的活动
    const [activeActivity, setActiveActivity] = useState<ActivityBlock | null>(null)

    // 大图预览状态
    const [showFullImage, setShowFullImage] = useState(false)

    // 流动气泡系统
    interface EventBubble {
        id: string
        activity: ActivityBlock
        createdAt: number // 创建时间戳
        startX: number // 初始 X 位置 (百分比)
        yOffset: number // Y 轴偏移
        lifespan: number // 生命周期（毫秒）
    }
    const [bubbles, setBubbles] = useState<EventBubble[]>([])
    const lastBubbleActivityRef = useRef<string>('') // 上一个生成气泡的活动 ID

    // 垂直洞察流系统
    interface InsightMessage {
        id: string
        timestamp: string // 格式化时间戳 [HH:MM]
        text: string
        color: string
        createdAt: number
    }
    const [insights, setInsights] = useState<InsightMessage[]>([])
    const lastInsightActivityRef = useRef<string>('')

    // 动画帧 ref
    const animationRef = useRef<number | null>(null)
    const lastFrameTimeRef = useRef<number>(0)

    // 视觉回溯截图缓存与工具函数
    const imageCacheRef = useRef<Map<string, string>>(new Map())

    const fetchSnapshotImageData = useCallback(async (path: string): Promise<string> => {
        if (!path) return ''
        if (imageCacheRef.current.has(path)) return imageCacheRef.current.get(path)!
        try {
            const dataUrl = await invoke<string>('visual_recall_get_image_data', { path })
            imageCacheRef.current.set(path, dataUrl)
            return dataUrl
        } catch {
            return ''
        }
    }, [])

    // 视觉回溯截图预览
    interface SnapshotInfo {
        id: number
        timestamp: number
        thumbPath: string
        fullPath?: string
        imageUrl: string
        app_name: string
        window_title: string
    }
    const [currentSnapshot, setCurrentSnapshot] = useState<SnapshotInfo | null>(null)
    const [allSnapshots, setAllSnapshots] = useState<SnapshotInfo[]>([])
    const [fullImageData, setFullImageData] = useState<string>('')
    const lastSnapshotIdRef = useRef<number | null>(null)

    // 加载活动数据
    useEffect(() => {
        if (!isOpen) return

        async function loadData() {
            // 重置所有状态，确保切换日期后从头开始
            setIsPlaying(false)
            setCurrentTime(0)
            setBubbles([])
            setInsights([])
            lastBubbleActivityRef.current = ''
            lastInsightActivityRef.current = ''

            setIsLoading(true)
            try {
                // 重置视觉回溯状态
                setCurrentSnapshot(null)
                lastSnapshotIdRef.current = null
                imageCacheRef.current.clear()

                // 计算时间范围基准：当天 0 点时间戳
                let startOfDay: number
                if (date) {
                    const [year, month, day] = date.split('-').map(Number)
                    const d = new Date(year, month - 1, day, 0, 0, 0, 0)
                    startOfDay = d.getTime()
                } else {
                    const d = new Date()
                    d.setHours(0, 0, 0, 0)
                    startOfDay = d.getTime()
                }
                setStartOfDayTimestamp(startOfDay)

                console.log('[TimeCapsule] Loading data for date:', date || 'today')
                let logs: ActivityLog[] = []
                try {
                    logs = await invoke('activity_get_today_logs', { date })
                    console.log('[TimeCapsule] Loaded', logs.length, 'logs')
                } catch (logErr) {
                    console.warn('[TimeCapsule] activity_get_today_logs failed:', logErr)
                }

                if (logs.length > 0) {
                    // 预处理：合并短于 2 秒的碎片
                    const merged = mergeFragments(logs, 2)
                    const blocks: ActivityBlock[] = merged.map(log => ({
                        id: log.id,
                        appName: log.appName,
                        windowTitle: log.windowTitle,
                        startTime: log.startTime,
                        endTime: log.endTime,
                        duration: log.duration,
                        category: log.category || 'unclassified',
                        color: CATEGORY_COLORS[log.category || 'unclassified']?.primary || '#64748b',
                        glowColor: CATEGORY_COLORS[log.category || 'unclassified']?.glow || '#94a3b8',
                    }))

                    const minTime = Math.min(...logs.map(l => l.startTime))
                    const maxTime = Math.max(...logs.map(l => l.endTime))
                    const startSeconds = Math.max(0, Math.floor((minTime - startOfDay) / 1000))
                    const endSeconds = Math.min(86400, Math.ceil((maxTime - startOfDay) / 1000))

                    setActivities(blocks)
                    setTimeRange({
                        start: startSeconds,
                        end: Math.max(startSeconds + 60, endSeconds)
                    })
                    setCurrentTime(startSeconds)
                } else {
                    setActivities([])
                }

                // 加载当天的视觉回溯截图
                try {
                    console.log(`[TimeCapsule] Requesting snapshots: ${startOfDay} to ${startOfDay + 86400 * 1000}`)
                    const response = await invoke<{ snapshots: any[]; total: number }>(
                        'visual_recall_search_snapshots',
                        {
                            startTime: startOfDay,
                            endTime: startOfDay + 86400 * 1000,
                            limit: 5000
                        }
                    )
                    if (response?.snapshots && response.snapshots.length > 0) {
                        const sorted = response.snapshots.sort((a, b) => a.timestamp - b.timestamp)
                        const mapped: SnapshotInfo[] = sorted.map(s => ({
                            id: s.id,
                            timestamp: s.timestamp,
                            thumbPath: s.thumbPath,
                            fullPath: s.fullPath,
                            imageUrl: imageCacheRef.current.get(s.thumbPath) || '',
                            app_name: s.appName || '',
                            window_title: s.windowTitle || ''
                        }))
                        setAllSnapshots(mapped)
                        console.log('[TimeCapsule] Loaded', mapped.length, 'visual recall snapshots')

                        // 如果之前没有活动日志，但有截图，则基于截图时间确定播放区间
                        if (logs.length === 0) {
                            const minSnap = sorted[0].timestamp
                            const maxSnap = sorted[sorted.length - 1].timestamp
                            const startSeconds = Math.max(0, Math.floor((minSnap - startOfDay) / 1000))
                            const endSeconds = Math.min(86400, Math.ceil((maxSnap - startOfDay) / 1000))
                            setTimeRange({
                                start: startSeconds,
                                end: Math.max(startSeconds + 60, endSeconds)
                            })
                            setCurrentTime(startSeconds)
                        }

                        // 预拉取前 6 张
                        mapped.slice(0, 6).forEach(s => {
                            if (s.thumbPath) fetchSnapshotImageData(s.thumbPath)
                        })
                    } else {
                        setAllSnapshots([])
                    }
                } catch (err) {
                    console.warn('[TimeCapsule] Failed to load visual recall snapshots:', err)
                }

                // 数据加载完成后自动开始播放
                setTimeout(() => setIsPlaying(true), 500)
            } catch (err) {
                console.error('[TimeCapsule] Failed to load data:', err)
            } finally {
                setIsLoading(false)
            }
        }

        loadData()
    }, [isOpen, date, fetchSnapshotImageData])

    // 根据当前时间更新截图 + 预加载
    useEffect(() => {
        if (allSnapshots.length === 0 || startOfDayTimestamp === 0) return

        const currentTimestamp = startOfDayTimestamp + currentTime * 1000

        // 二分查找当前时间最接近的截图（向前查找）
        let left = 0
        let right = allSnapshots.length - 1
        let closestIndex = -1

        while (left <= right) {
            const mid = Math.floor((left + right) / 2)
            if (allSnapshots[mid].timestamp <= currentTimestamp) {
                closestIndex = mid
                left = mid + 1
            } else {
                right = mid - 1
            }
        }

        if (closestIndex >= 0) {
            const closest = allSnapshots[closestIndex]

            // 只有切换到新截图时才更新
            if (closest.id !== lastSnapshotIdRef.current) {
                lastSnapshotIdRef.current = closest.id
                
                // 加载图片
                if (closest.imageUrl) {
                    setCurrentSnapshot(closest)
                } else if (closest.thumbPath && imageCacheRef.current.has(closest.thumbPath)) {
                    const cachedUrl = imageCacheRef.current.get(closest.thumbPath)!
                    closest.imageUrl = cachedUrl
                    setCurrentSnapshot({ ...closest, imageUrl: cachedUrl })
                } else if (closest.thumbPath) {
                    fetchSnapshotImageData(closest.thumbPath).then(dataUrl => {
                        if (lastSnapshotIdRef.current === closest.id) {
                            closest.imageUrl = dataUrl
                            setCurrentSnapshot({ ...closest, imageUrl: dataUrl })
                        }
                    })
                }

                // 预加载后续截图
                const preloadCount = playbackSpeed >= 16 ? 12 : 6
                for (let i = 1; i <= preloadCount; i++) {
                    const nextSnapshot = allSnapshots[closestIndex + i]
                    if (nextSnapshot && nextSnapshot.thumbPath) {
                        fetchSnapshotImageData(nextSnapshot.thumbPath)
                    }
                }
            }
        } else {
            // 当前时间小于第一张截图的时间
            // 策略：如果距离第一张截图很近（比如 60 秒内），则预先显示第一张，避免开场空白
            const firstSnapshot = allSnapshots[0]
            if (firstSnapshot && (firstSnapshot.timestamp - currentTimestamp < 60 * 1000)) {
                if (firstSnapshot.id !== lastSnapshotIdRef.current) {
                    lastSnapshotIdRef.current = firstSnapshot.id
                    if (firstSnapshot.imageUrl) {
                        setCurrentSnapshot(firstSnapshot)
                    } else if (firstSnapshot.thumbPath && imageCacheRef.current.has(firstSnapshot.thumbPath)) {
                        const cachedUrl = imageCacheRef.current.get(firstSnapshot.thumbPath)!
                        firstSnapshot.imageUrl = cachedUrl
                        setCurrentSnapshot({ ...firstSnapshot, imageUrl: cachedUrl })
                    } else if (firstSnapshot.thumbPath) {
                        fetchSnapshotImageData(firstSnapshot.thumbPath).then(dataUrl => {
                            if (lastSnapshotIdRef.current === firstSnapshot.id) {
                                firstSnapshot.imageUrl = dataUrl
                                setCurrentSnapshot({ ...firstSnapshot, imageUrl: dataUrl })
                            }
                        })
                    }
                }
            } else {
                // 否则清除截图（避免显示上一轮会话的残留图片，或者 Seek 到开头时显示旧图）
                if (lastSnapshotIdRef.current !== null) {
                    lastSnapshotIdRef.current = null
                    setCurrentSnapshot(null)
                }
            }
        }
    }, [currentTime, allSnapshots, startOfDayTimestamp, playbackSpeed, fetchSnapshotImageData])

    // 大图预览按需异步拉取清晰大图
    useEffect(() => {
        if (showFullImage && currentSnapshot) {
            const targetPath = currentSnapshot.fullPath || currentSnapshot.thumbPath
            if (targetPath) {
                fetchSnapshotImageData(targetPath).then(dataUrl => {
                    setFullImageData(dataUrl)
                })
            } else {
                setFullImageData(currentSnapshot.imageUrl || '')
            }
        } else {
            setFullImageData('')
        }
    }, [showFullImage, currentSnapshot, fetchSnapshotImageData])

    // 合并碎片活动 - 只合并同一应用的连续片段
    function mergeFragments(logs: ActivityLog[], _minDuration: number): ActivityLog[] {
        if (logs.length === 0) return []

        const sorted = [...logs].sort((a, b) => a.startTime - b.startTime)
        const result: ActivityLog[] = []
        let current = { ...sorted[0] }

        for (let i = 1; i < sorted.length; i++) {
            const log = sorted[i]
            // 只有当是同一个应用且间隔很短时才合并
            if (log.appName === current.appName && log.startTime - current.endTime < 5000) {
                current.endTime = log.endTime
                current.duration = current.endTime - current.startTime
            } else {
                // 不同应用，保留当前块并开始新块
                result.push(current)
                current = { ...log }
            }
        }
        result.push(current)

        return result
    }

    // 播放动画循环（含智能跳速）
    const animate = useCallback((timestamp: number) => {
        if (!lastFrameTimeRef.current) {
            lastFrameTimeRef.current = timestamp
        }

        const deltaTime = timestamp - lastFrameTimeRef.current
        lastFrameTimeRef.current = timestamp

        // 根据倍速计算时间增量（实际秒数）
        let timeIncrement = (deltaTime / 1000) * playbackSpeed

        setCurrentTime(prev => {
            let next = prev + timeIncrement

            // 智能跳速：检查是否处于空闲时段
            const startOfDay = new Date().setHours(0, 0, 0, 0)
            const nextTimestamp = startOfDay + next * 1000

            // 查找下一个活动
            const isInActivity = activities.some(a =>
                a.startTime <= nextTimestamp && a.endTime >= nextTimestamp
            )

            // 如果不在活动中且播放速度 >= 64x，自动快进到下一个活动
            if (!isInActivity && playbackSpeed >= 64) {
                const nextActivity = activities.find(a => a.startTime > nextTimestamp)
                if (nextActivity) {
                    const skipToTime = (nextActivity.startTime - startOfDay) / 1000
                    // 平滑跳转，每帧最多跳 5 分钟
                    const maxSkipPerFrame = 300 // 秒
                    if (skipToTime - next > maxSkipPerFrame) {
                        next = next + maxSkipPerFrame
                    } else {
                        next = skipToTime
                    }
                }
            }

            // 到达结尾时停止
            if (next >= timeRange.end) {
                setIsPlaying(false)
                return timeRange.end
            }
            return next
        })

        if (isPlaying) {
            animationRef.current = requestAnimationFrame(animate)
        }
    }, [isPlaying, playbackSpeed, timeRange.end, activities])

    // 开始/停止播放
    useEffect(() => {
        if (isPlaying) {
            lastFrameTimeRef.current = 0
            animationRef.current = requestAnimationFrame(animate)
        } else if (animationRef.current) {
            cancelAnimationFrame(animationRef.current)
        }

        return () => {
            if (animationRef.current) {
                cancelAnimationFrame(animationRef.current)
            }
        }
    }, [isPlaying, animate])

    // 更新当前激活的活动 + 生成流动气泡
    useEffect(() => {
        if (activities.length === 0 || startOfDayTimestamp === 0) return

        // 使用正确的 startOfDay（从state获取，而非硬编码）
        const currentTimestamp = startOfDayTimestamp + currentTime * 1000

        const active = activities.find(a =>
            a.startTime <= currentTimestamp && a.endTime >= currentTimestamp
        )
        setActiveActivity(active || null)

        // 生成流动气泡逻辑
        if (active && active.id !== lastBubbleActivityRef.current) {
            // 256x 以上：随机过滤掉一半的 10 秒及以下短活动
            if (playbackSpeed >= 256 && active.duration <= 10 * 1000 && Math.random() < 0.8) {
                lastBubbleActivityRef.current = active.id
                return
            }
            // 1024x 以上过滤掉 30 秒及以下的短活动
            if (playbackSpeed >= 1024 && active.duration < 30 * 1000) {
                lastBubbleActivityRef.current = active.id
                return
            }

            lastBubbleActivityRef.current = active.id

            // 计算时间指针位置（百分比）
            const playheadProgress = ((currentTime - timeRange.start) / (timeRange.end - timeRange.start)) * 100

            // 固定高度：时间轴上方 80px
            const yPosition = 80

            // 计算气泡生命周期：
            // 短活动（≤30秒）：生命周期 3 秒，会在移动途中消失
            // 长活动（>30秒）：生命周期 6 秒，会移动到最左边后消失
            const activityDurationSec = active.duration / 1000
            const lifespan = activityDurationSec <= 30 ? 3000 : 6000

            // 生成新气泡 - 从时间指针位置往右 5% 开始（约 50px）
            const newBubble = {
                id: `bubble-${active.id}-${Date.now()}`,
                activity: active,
                createdAt: Date.now(),
                startX: Math.min(playheadProgress + 5, 98),
                yOffset: yPosition,
                lifespan
            }

            setBubbles(prev => [...prev, newBubble])
        }

        // 清理过期气泡（使用每个气泡的动态生命周期）
        setBubbles(prev => prev.filter(b => Date.now() - b.createdAt < b.lifespan))

        // 生成洞察消息逻辑
        if (active && active.id !== lastInsightActivityRef.current) {
            // 高倍速合并：> 128x 时只保留重要消息
            const shouldMerge = playbackSpeed > 128 && active.duration < 120 * 1000

            if (!shouldMerge) {
                lastInsightActivityRef.current = active.id

                // 格式化时间戳
                const hours = Math.floor(currentTime / 3600)
                const mins = Math.floor((currentTime % 3600) / 60)
                const timestamp = `[${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}]`

                // 根据类别生成洞察文本
                const categoryText: Record<string, string> = {
                    development: '🚀 进入深度开发模式',
                    communication: '💬 切换至沟通协作',
                    browsing: '🌐 开始信息探索',
                    productivity: '⚡ 生产力时段开始',
                    entertainment: '🎮 休闲娱乐时间',
                    system: '⚙️ 系统操作中',
                    unclassified: '📌 其他活动',
                }

                const newInsight: InsightMessage = {
                    id: `insight-${active.id}-${Date.now()}`,
                    timestamp,
                    text: `${categoryText[active.category] || '📌 活动切换'} → ${active.appName}`,
                    color: active.color,
                    createdAt: Date.now(),
                }

                // 保持最多 4 条消息
                setInsights(prev => [...prev, newInsight].slice(-4))
            }
        }
    }, [currentTime, activities, playbackSpeed, timeRange, startOfDayTimestamp])

    // 键盘快捷键
    useEffect(() => {
        if (!isOpen) return

        const handleKeyDown = (e: KeyboardEvent) => {
            switch (e.key) {
                case ' ':
                    e.preventDefault()
                    setIsPlaying(p => !p)
                    break
                case 'Escape':
                    // 如果大图预览打开，先关闭大图
                    if (showFullImage) {
                        setShowFullImage(false)
                    } else {
                        onClose()
                    }
                    break
                case 'ArrowRight':
                    setCurrentTime(t => Math.min(t + 60, timeRange.end))
                    break
                case 'ArrowLeft':
                    setCurrentTime(t => Math.max(t - 60, timeRange.start))
                    break
            }
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [isOpen, onClose, timeRange, showFullImage])

    // 进度跳转
    const handleSeek = useCallback((time: number) => {
        setCurrentTime(time)
    }, [])

    // 倍速切换
    const handleSpeedChange = useCallback((speed: number) => {
        setPlaybackSpeed(speed)
    }, [])

    // 重置播放
    const handleReset = useCallback(() => {
        setCurrentTime(timeRange.start)
        setIsPlaying(false)
    }, [timeRange.start])

    if (!isOpen) return null

    return (
        <AnimatePresence>
            <motion.div
                className="fixed inset-0 z-50 flex flex-col"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
            >
                {/* 沉浸式背景 */}
                <div className="absolute inset-0 bg-zinc-950" />

                {/* 3D 科技感网格背景 - 带视差效果 */}
                <div
                    className="absolute inset-0 opacity-20 pointer-events-none"
                    style={{
                        backgroundImage: `
                            linear-gradient(rgba(139, 92, 246, 0.3) 1px, transparent 1px),
                            linear-gradient(90deg, rgba(139, 92, 246, 0.3) 1px, transparent 1px)
                        `,
                        backgroundSize: '60px 60px',
                        transform: `perspective(1000px) rotateX(60deg) translateY(${-(currentTime % 60) * playbackSpeed * 0.01}px)`,
                        transformOrigin: 'top center',
                        transition: playbackSpeed > 64 ? 'none' : 'transform 0.1s linear'
                    }}
                />

                {/* 极光渐变背景 */}
                <div
                    className="absolute inset-0 opacity-30"
                    style={{
                        background: 'radial-gradient(ellipse at 30% 20%, rgba(139, 92, 246, 0.3) 0%, transparent 50%), radial-gradient(ellipse at 70% 80%, rgba(6, 182, 212, 0.2) 0%, transparent 50%)'
                    }}
                />

                {/* 关闭按钮 - 默认隐藏，悬浮右上角时显示 */}
                <div className="absolute top-0 right-0 w-24 h-24 z-50 group">
                    <motion.button
                        className="absolute top-6 right-6 p-3 rounded-full bg-white/10 hover:bg-white/20 transition-all opacity-0 group-hover:opacity-100"
                        onClick={onClose}
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.95 }}
                    >
                        <X className="w-6 h-6 text-white" />
                    </motion.button>
                </div>

                {/* 标题区域 */}
                <div className="relative z-10 pt-12 pb-6 text-center">
                    <motion.h1
                        className="text-4xl font-bold text-white tracking-tight"
                        initial={{ y: -20, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ delay: 0.2 }}
                    >
                        EVA: Recalling your day...
                    </motion.h1>
                    <motion.p
                        className="mt-2 text-zinc-400"
                        initial={{ y: -10, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ delay: 0.3 }}
                    >
                        观看你的一天
                    </motion.p>
                </div>

                {/* 流动历史栈气泡系统 - 下移给预览图片留空间 */}
                <div className="absolute inset-x-0 top-[320px] bottom-[220px] z-20 pointer-events-none overflow-hidden px-8">
                    <AnimatePresence>
                        {bubbles.map(bubble => {
                            const age = Date.now() - bubble.createdAt
                            const lifeProgress = age / bubble.lifespan // 生命周期进度（控制淡出）

                            // 保持大小不变，只淡出
                            const scale = 1
                            const opacity = Math.max(0, 1 - lifeProgress) // 1 → 0

                            // 跳过太透明的气泡
                            if (opacity < 0.15) return null

                            // 移动速度根据倍速调整：1x=8秒, 64x=5秒, 256x=3秒, 1024x=2秒
                            const moveDuration = playbackSpeed >= 256 ? 2000 : playbackSpeed >= 64 ? 4000 : 6000
                            const moveProgress = Math.min(age / moveDuration, 1)
                            const currentX = bubble.startX - moveProgress * 110

                            // 移除运动模糊，保持气泡清晰
                            const motionBlur = 0

                            // 拖尾残影长度
                            const trailLength = Math.min(80 + playbackSpeed * 0.3, 200)

                            return (
                                <motion.div
                                    key={bubble.id}
                                    className="absolute"
                                    style={{
                                        left: `${currentX}%`,
                                        bottom: `20px`,
                                        transform: `translateY(-${bubble.yOffset}px)`,
                                    }}
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity, scale }}
                                    exit={{ opacity: 0 }}
                                    transition={{
                                        opacity: { duration: 0.3 },
                                        scale: { duration: 0.3 }
                                    }}
                                >
                                    {/* 拖尾残影 (Trailing Glow) */}
                                    <div
                                        className="absolute top-1/2 right-0 h-full pointer-events-none"
                                        style={{
                                            width: `${trailLength}px`,
                                            transform: 'translateY(-50%) translateX(100%)',
                                            background: `linear-gradient(to right, ${bubble.activity.glowColor}40, ${bubble.activity.glowColor}10, transparent)`,
                                            opacity: opacity * 0.6,
                                            filter: 'blur(8px)',
                                            borderRadius: '0 20px 20px 0',
                                        }}
                                    />

                                    <div
                                        className="px-4 py-2 rounded-xl backdrop-blur-md border border-white/10 whitespace-nowrap relative"
                                        style={{
                                            background: `linear-gradient(135deg, ${bubble.activity.color}25, ${bubble.activity.color}10)`,
                                            boxShadow: `0 4px 24px ${bubble.activity.glowColor}40, 0 0 40px ${bubble.activity.glowColor}20`,
                                            filter: `blur(${motionBlur}px)`,
                                        }}
                                    >
                                        <div className="flex items-center gap-2">
                                            <div
                                                className="w-2 h-2 rounded-full"
                                                style={{ backgroundColor: bubble.activity.color }}
                                            />
                                            <span
                                                className="text-sm text-white font-medium"
                                            >
                                                {bubble.activity.appName}
                                            </span>
                                        </div>
                                    </div>
                                </motion.div>
                            )
                        })}
                    </AnimatePresence>
                </div>

                {/* Canvas 时间轴 - 下移 */}
                <div className="flex-1 relative z-10 px-8 py-4 min-h-[180px] mt-[80px]">
                    {isLoading ? (
                        <div className="flex items-center justify-center h-full">
                            <div className="text-zinc-400">正在加载时间轴数据...</div>
                        </div>
                    ) : activities.length === 0 ? (
                        <div className="flex items-center justify-center h-full">
                            <div className="text-zinc-400">今日暂无活动记录</div>
                        </div>
                    ) : (
                        <TimelineCanvas
                            activities={activities}
                            currentTime={currentTime}
                            timeRange={timeRange}
                            startOfDay={startOfDayTimestamp}
                            onSeek={handleSeek}
                            playbackSpeed={playbackSpeed}
                        />
                    )}
                </div>

                {/* 悬浮截图预览窗口 - 全息投影效果 */}
                <AnimatePresence mode="sync">
                    {currentSnapshot && currentSnapshot.imageUrl && (() => {
                        // 计算时间线位置（百分比）
                        const range = timeRange.end - timeRange.start
                        const timelineProgress = range > 0
                            ? Math.min(100, Math.max(0, ((currentTime - timeRange.start) / range) * 100))
                            : 0

                        // 动态 3D 旋转：根据在时间轴上的进度计算微弱偏转 (-6deg 到 +6deg)
                        const rotateY = (timelineProgress - 50) * 0.12

                        // Warp 模式运动模糊
                        const warpBlur = playbackSpeed >= 256 ? Math.min((playbackSpeed - 256) * 0.008, 3) : 0

                        return (
                            <motion.div
                                key={currentSnapshot.id}
                                className={`absolute z-50 ${!isPlaying ? 'pointer-events-auto cursor-pointer' : 'pointer-events-none'}`}
                                style={{
                                    top: '90px',
                                    left: `clamp(32px, calc(${timelineProgress}% - 130px), calc(100% - 292px))`,
                                    width: '260px',
                                    perspective: '1000px',
                                }}
                                initial={{ opacity: 0, y: -10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -10 }}
                                transition={{ duration: 0.2, ease: 'easeOut' }}
                                onClick={() => !isPlaying && setShowFullImage(true)}
                            >
                                {/* 全息投影引导线 - 从预览窗底部到时间轴 */}
                                <svg
                                    className="absolute left-1/2 top-full pointer-events-none"
                                    style={{
                                        width: '4px',
                                        height: 'calc(100vh - 420px)',
                                        transform: 'translateX(-50%)',
                                    }}
                                >
                                    <defs>
                                        <linearGradient id="holoGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                                            <stop offset="0%" stopColor="#8B5CF6" stopOpacity="0.8" />
                                            <stop offset="50%" stopColor="#8B5CF6" stopOpacity="0.4" />
                                            <stop offset="100%" stopColor="#8B5CF6" stopOpacity="0" />
                                        </linearGradient>
                                    </defs>
                                    <line
                                        x1="2" y1="0" x2="2" y2="100%"
                                        stroke="url(#holoGradient)"
                                        strokeWidth="2"
                                        strokeDasharray="12 6"
                                        style={{
                                            animation: 'dashFlow 1.5s linear infinite',
                                        }}
                                    />
                                </svg>

                                {/* 预览窗主体 - 3D 全息效果 + 呼吸发光 */}
                                <div
                                    className={`rounded-xl overflow-hidden backdrop-blur-2xl border-2 border-white/30 bg-black/50 ${!isPlaying ? 'hover:border-white/50 transition-all' : ''}`}
                                    style={{
                                        transform: `rotateY(${rotateY}deg) rotateX(5deg)`,
                                        transformStyle: 'preserve-3d',
                                        boxShadow: `0 0 40px rgba(139, 92, 246, 0.25), 0 20px 60px ${activeActivity?.glowColor || '#8b5cf6'}30, inset 0 1px 0 rgba(255,255,255,0.15)`,
                                        animation: 'holoGlow 3s ease-in-out infinite',
                                        filter: warpBlur > 0 ? `blur(${warpBlur}px)` : 'none',
                                    }}
                                >
                                    {/* 全息扫描线效果 */}
                                    <div
                                        className="absolute inset-0 pointer-events-none z-10"
                                        style={{
                                            background: 'linear-gradient(to bottom, transparent 0%, rgba(139, 92, 246, 0.08) 50%, transparent 100%)',
                                            animation: 'holoScan 2.5s ease-in-out infinite',
                                        }}
                                    />
                                    <img
                                        src={currentSnapshot.imageUrl}
                                        alt="Screen capture"
                                        className="w-full h-auto object-cover"
                                        style={{
                                            aspectRatio: '16/10',
                                            filter: warpBlur > 0 ? `blur(${warpBlur * 0.5}px)` : 'none'
                                        }}
                                    />
                                    {/* 底部信息栏 */}
                                    <div className="px-3 py-2 bg-black/80 backdrop-blur-xl flex items-center gap-2 border-t border-white/10">
                                        <div
                                            className="w-2 h-2 rounded-full shrink-0 animate-pulse"
                                            style={{ backgroundColor: activeActivity?.color || '#8b5cf6' }}
                                        />
                                        <span className="text-xs text-white/90 truncate font-medium">
                                            {currentSnapshot.app_name}
                                        </span>
                                        <span className="text-xs text-white/50 truncate flex-1">
                                            {currentSnapshot.window_title}
                                        </span>
                                        {!isPlaying && (
                                            <span className="text-xs text-white/40">点击放大</span>
                                        )}
                                    </div>
                                </div>
                            </motion.div>
                        )
                    })()}
                </AnimatePresence>

                {/* 大图预览模态框 */}
                <AnimatePresence>
                    {showFullImage && currentSnapshot && (
                        <motion.div
                            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 cursor-pointer"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setShowFullImage(false)}
                        >
                            <motion.img
                                src={fullImageData || currentSnapshot.imageUrl}
                                alt="Full screen capture"
                                className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
                                initial={{ scale: 0.8, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                exit={{ scale: 0.8, opacity: 0 }}
                                transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                            />
                            <div className="absolute bottom-8 left-1/2 -translate-x-1/2 text-white/60 text-sm">
                                点击任意位置关闭
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* 垂直滚动洞察流 (Vertical Insight Stream) - 磨砂底衬 */}
                <div className="relative z-10 px-8 h-[150px] flex flex-col justify-end overflow-hidden">
                    {/* 磨砂背景底衬 */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-black/20 to-transparent backdrop-blur-sm" />
                    <div className="max-w-2xl mx-auto w-full relative">
                        <AnimatePresence>
                            {insights.map((insight, index) => {
                                // 渐隐效果：最新的最亮，往上递减
                                const position = insights.length - 1 - index
                                const opacityMap = [1, 0.6, 0.3, 0.1]
                                const opacity = opacityMap[position] || 0

                                // 越旧的消息越模糊
                                const blurAmount = position * (playbackSpeed > 64 ? 1.5 : 0.5)

                                return (
                                    <motion.div
                                        key={insight.id}
                                        className="mb-2 relative"
                                        initial={{ opacity: 0, y: 30, scale: 0.95 }}
                                        animate={{
                                            opacity,
                                            y: 0,
                                            scale: 1,
                                            filter: `blur(${blurAmount}px)`
                                        }}
                                        exit={{ opacity: 0, y: -20, scale: 0.9 }}
                                        transition={{
                                            type: 'spring',
                                            stiffness: 400,
                                            damping: 30
                                        }}
                                    >
                                        {/* 新消息紫色发光渐变 */}
                                        {position === 0 && (
                                            <div
                                                className="absolute -inset-2 rounded-lg pointer-events-none"
                                                style={{
                                                    background: `radial-gradient(ellipse at center, ${insight.color}15 0%, transparent 70%)`,
                                                }}
                                            />
                                        )}
                                        <div
                                            className="font-mono text-sm leading-relaxed relative"
                                        >
                                            <span className="text-zinc-500 mr-2">{insight.timestamp}</span>
                                            <span style={{ color: insight.color }}>{insight.text}</span>
                                        </div>
                                    </motion.div>
                                )
                            })}
                        </AnimatePresence>
                    </div>
                </div>

                {/* 播放控制条 */}
                <PlaybackControls
                    isPlaying={isPlaying}
                    currentTime={currentTime}
                    timeRange={timeRange}
                    playbackSpeed={playbackSpeed}
                    onPlayPause={() => setIsPlaying(p => !p)}
                    onSeek={handleSeek}
                    onSpeedChange={handleSpeedChange}
                    onReset={handleReset}
                />
            </motion.div>
        </AnimatePresence>
    )
}
