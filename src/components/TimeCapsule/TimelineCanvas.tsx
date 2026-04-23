/**
 * TimelineCanvas - 高性能 Canvas 时间轴渲染器
 * 使用 requestAnimationFrame 实现 120fps 流畅动画
 */

import React, { useRef, useEffect, useCallback, useState } from 'react'

// 活动块数据类型
export interface ActivityBlock {
    id: string
    appName: string
    windowTitle: string
    startTime: number
    endTime: number
    duration: number
    category: string
    color: string
    glowColor: string
}

// 时间范围
export interface TimelineData {
    start: number
    end: number
}

interface TimelineCanvasProps {
    activities: ActivityBlock[]
    currentTime: number // 当天的秒数
    timeRange: TimelineData
    startOfDay: number // 当天0点的时间戳，用于正确计算位置
    onSeek: (time: number) => void
    playbackSpeed?: number // 播放倍速，用于动态模糊效果
}

// 时间格式化
function formatTimeLabel(seconds: number): string {
    const hours = Math.floor(seconds / 3600)
    const mins = Math.floor((seconds % 3600) / 60)
    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`
}

export function TimelineCanvas({
    activities,
    currentTime,
    timeRange,
    startOfDay,
    onSeek,
    playbackSpeed = 1
}: TimelineCanvasProps): React.ReactElement {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const animationRef = useRef<number | null>(null)
    const [dimensions, setDimensions] = useState({ width: 0, height: 0 })

    // 扫描线激活效果状态
    const activeBlocksRef = useRef<Map<string, number>>(new Map()) // id -> activation level (0-1)

    // 监听容器尺寸变化
    useEffect(() => {
        const container = containerRef.current
        if (!container) return

        const resizeObserver = new ResizeObserver(entries => {
            const entry = entries[0]
            if (entry) {
                const { width, height } = entry.contentRect
                setDimensions({ width, height })
            }
        })

        resizeObserver.observe(container)
        return () => resizeObserver.disconnect()
    }, [])

    // 在尺寸变化时更新 Canvas 实际像素大小 (支持高 DPI)
    useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas || dimensions.width === 0) return

        const dpr = window.devicePixelRatio || 1
        canvas.width = dimensions.width * dpr
        canvas.height = dimensions.height * dpr
        const ctx = canvas.getContext('2d')
        if (ctx) {
            ctx.scale(dpr, dpr)
        }
    }, [dimensions])

    // Canvas 绘制核心逻辑
    const draw = useCallback(() => {
        const canvas = canvasRef.current
        if (!canvas || dimensions.width === 0) return

        const ctx = canvas.getContext('2d', { alpha: true })
        if (!ctx) return

        const { width, height } = dimensions

        // 清空画布
        ctx.clearRect(0, 0, width, height)

        // 布局参数
        const padding = { left: 60, right: 40, top: 60, bottom: 80 }
        const timelineWidth = width - padding.left - padding.right
        const timelineHeight = Math.min(120, height - padding.top - padding.bottom)
        const timelineY = (height - timelineHeight) / 2

        // 时间范围
        const duration = timeRange.end - timeRange.start
        const pixelsPerSecond = timelineWidth / duration

        // 当前扫描线位置
        const scanlineX = padding.left + (currentTime - timeRange.start) * pixelsPerSecond
        // startOfDay 通过 props 传入，确保日期正确

        // 绘制时间刻度
        ctx.font = '12px Inter, system-ui, sans-serif'
        ctx.fillStyle = '#71717a'
        ctx.textAlign = 'center'

        // 每小时一个刻度
        for (let sec = Math.ceil(timeRange.start / 3600) * 3600; sec <= timeRange.end; sec += 3600) {
            const x = padding.left + (sec - timeRange.start) * pixelsPerSecond
            ctx.fillText(formatTimeLabel(sec), x, timelineY + timelineHeight + 30)

            // 刻度线
            ctx.strokeStyle = '#3f3f46'
            ctx.lineWidth = 1
            ctx.beginPath()
            ctx.moveTo(x, timelineY)
            ctx.lineTo(x, timelineY + timelineHeight)
            ctx.stroke()
        }

        // 绘制活动色块
        for (const block of activities) {
            const blockStartSec = (block.startTime - startOfDay) / 1000
            const blockEndSec = (block.endTime - startOfDay) / 1000

            const x = padding.left + (blockStartSec - timeRange.start) * pixelsPerSecond
            const w = (blockEndSec - blockStartSec) * pixelsPerSecond
            const y = timelineY
            const h = timelineHeight

            // 计算激活程度（扫描线经过时激活）
            const currentTimestamp = startOfDay + currentTime * 1000
            const isActive = block.startTime <= currentTimestamp && block.endTime >= currentTimestamp
            const isPast = block.endTime < currentTimestamp

            // 更新激活状态
            let activationLevel = activeBlocksRef.current.get(block.id) || 0
            if (isActive) {
                activationLevel = Math.min(activationLevel + 0.1, 1)
            } else if (isPast) {
                activationLevel = Math.max(activationLevel - 0.02, 0.3) // 过去的保持微弱发光
            } else {
                activationLevel = Math.max(activationLevel - 0.05, 0.1) // 未来的很暗
            }
            activeBlocksRef.current.set(block.id, activationLevel)

            // 基础透明度
            const baseOpacity = isPast ? 0.6 : (isActive ? 1 : 0.2)

            // 绘制发光效果（如果激活）
            if (activationLevel > 0.5) {
                const glowIntensity = (activationLevel - 0.5) * 2
                ctx.shadowColor = block.glowColor
                ctx.shadowBlur = 20 * glowIntensity
                ctx.shadowOffsetY = 0
            } else {
                ctx.shadowBlur = 0
            }

            // 绘制色块（圆角矩形）
            const radius = 4
            ctx.fillStyle = block.color
            ctx.globalAlpha = baseOpacity * activationLevel

            // 高速模式 (>64x) 动态模糊效果
            if (playbackSpeed > 64 && (isActive || isPast)) {
                // 保存当前状态
                ctx.save()

                // 模糊拖尾效果 - 在色块右侧绘制渐变拖尾
                const blurLength = Math.min(playbackSpeed * 0.1, 50) // 最大 50px 模糊
                const blurGradient = ctx.createLinearGradient(x + w, 0, x + w + blurLength, 0)
                blurGradient.addColorStop(0, block.color)
                blurGradient.addColorStop(1, 'transparent')

                ctx.globalAlpha = baseOpacity * activationLevel * 0.5
                ctx.fillStyle = blurGradient
                ctx.fillRect(x + w, y, blurLength, h)

                ctx.restore()
                ctx.fillStyle = block.color
                ctx.globalAlpha = baseOpacity * activationLevel
            }

            ctx.beginPath()
            ctx.roundRect(x, y, Math.max(w, 2), h, radius)
            ctx.fill()

            // 重置
            ctx.globalAlpha = 1
            ctx.shadowBlur = 0
        }

        // 绘制扫描线
        const gradient = ctx.createLinearGradient(scanlineX - 30, 0, scanlineX, 0)
        gradient.addColorStop(0, 'rgba(139, 92, 246, 0)')
        gradient.addColorStop(0.7, 'rgba(139, 92, 246, 0.3)')
        gradient.addColorStop(1, 'rgba(139, 92, 246, 0.8)')

        // 拖尾
        ctx.fillStyle = gradient
        ctx.fillRect(scanlineX - 30, timelineY - 10, 30, timelineHeight + 20)

        // 主线
        ctx.strokeStyle = '#a78bfa'
        ctx.lineWidth = 2
        ctx.shadowColor = '#a78bfa'
        ctx.shadowBlur = 15
        ctx.beginPath()
        ctx.moveTo(scanlineX, timelineY - 20)
        ctx.lineTo(scanlineX, timelineY + timelineHeight + 20)
        ctx.stroke()
        ctx.shadowBlur = 0

        // 扫描线顶部时间标签
        ctx.fillStyle = '#a78bfa'
        ctx.font = 'bold 14px Inter, system-ui, sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText(formatTimeLabel(currentTime), scanlineX, timelineY - 30)

        // 请求下一帧
        animationRef.current = requestAnimationFrame(draw)
    }, [activities, currentTime, timeRange, dimensions, playbackSpeed])

    // 启动渲染循环
    useEffect(() => {
        animationRef.current = requestAnimationFrame(draw)
        return () => {
            if (animationRef.current) {
                cancelAnimationFrame(animationRef.current)
            }
        }
    }, [draw])

    // 点击跳转
    const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current
        if (!canvas) return

        const rect = canvas.getBoundingClientRect()
        const x = e.clientX - rect.left

        const padding = { left: 60, right: 40 }
        const timelineWidth = dimensions.width - padding.left - padding.right

        if (x < padding.left || x > dimensions.width - padding.right) return

        const relativeX = x - padding.left
        const progress = relativeX / timelineWidth
        const time = timeRange.start + (timeRange.end - timeRange.start) * progress

        onSeek(time)
    }, [dimensions, timeRange, onSeek])

    return (
        <div
            ref={containerRef}
            className="w-full h-full cursor-pointer"
        >
            <canvas
                ref={canvasRef}
                style={{ width: '100%', height: '100%' }}
                onClick={handleClick}
            />
        </div>
    )
}
