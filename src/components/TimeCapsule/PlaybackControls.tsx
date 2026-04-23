/**
 * PlaybackControls - 播放控制条
 * 极简设计，支持倍速切换和进度拖拽
 */

import React, { useCallback } from 'react'
import { motion } from 'framer-motion'
import { Play, Pause, RotateCcw } from 'lucide-react'

interface PlaybackControlsProps {
    isPlaying: boolean
    currentTime: number
    timeRange: { start: number; end: number }
    playbackSpeed: number
    onPlayPause: () => void
    onSeek: (time: number) => void
    onSpeedChange: (speed: number) => void
    onReset: () => void
}

// 可选倍速
const SPEEDS = [1, 4, 16, 64, 256, 1024]

// Warp 模式倍速（超高速）
const WARP_SPEED = 9999

// 时间格式化
function formatTime(seconds: number): string {
    const hours = Math.floor(seconds / 3600)
    const mins = Math.floor((seconds % 3600) / 60)
    const secs = Math.floor(seconds % 60)
    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
}

export function PlaybackControls({
    isPlaying,
    currentTime,
    timeRange,
    playbackSpeed,
    onPlayPause,
    onSeek,
    onSpeedChange,
    onReset
}: PlaybackControlsProps): React.ReactElement {
    // 进度百分比
    const progress = ((currentTime - timeRange.start) / (timeRange.end - timeRange.start)) * 100

    // 拖拽进度条
    const handleProgressChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const value = parseFloat(e.target.value)
        const time = timeRange.start + (timeRange.end - timeRange.start) * (value / 100)
        onSeek(time)
    }, [timeRange, onSeek])

    return (
        <motion.div
            className="relative z-10 px-8 py-6 bg-zinc-900/80 backdrop-blur-xl border-t border-white/5"
            initial={{ y: 50, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.4 }}
        >
            <div className="max-w-4xl mx-auto">
                {/* 进度条 */}
                <div className="relative mb-4">
                    <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
                        <motion.div
                            className="h-full bg-gradient-to-r from-violet-500 to-cyan-500"
                            style={{ width: `${progress}%` }}
                            transition={{ duration: 0.1 }}
                        />
                    </div>
                    <input
                        type="range"
                        min={0}
                        max={100}
                        step={0.1}
                        value={progress}
                        onChange={handleProgressChange}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                </div>

                {/* 控制按钮 */}
                <div className="flex items-center justify-between">
                    {/* 左侧：时间显示 */}
                    <div className="flex items-center gap-4 text-sm text-zinc-400 font-mono">
                        <span>{formatTime(currentTime)}</span>
                        <span className="text-zinc-600">/</span>
                        <span>{formatTime(timeRange.end)}</span>
                    </div>

                    {/* 中间：播放控制 */}
                    <div className="flex items-center gap-4">
                        {/* 重置按钮 */}
                        <motion.button
                            className="p-2 rounded-full text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"
                            onClick={onReset}
                            whileHover={{ scale: 1.1 }}
                            whileTap={{ scale: 0.95 }}
                        >
                            <RotateCcw className="w-5 h-5" />
                        </motion.button>

                        {/* 播放/暂停按钮 */}
                        <motion.button
                            className="p-4 rounded-full bg-gradient-to-r from-violet-500 to-purple-600 text-white shadow-lg shadow-violet-500/30"
                            onClick={onPlayPause}
                            whileHover={{ scale: 1.1 }}
                            whileTap={{ scale: 0.95 }}
                        >
                            {isPlaying ? (
                                <Pause className="w-6 h-6" />
                            ) : (
                                <Play className="w-6 h-6 ml-0.5" />
                            )}
                        </motion.button>

                        {/* 倍速选择器 */}
                        <div className="flex items-center gap-1 bg-zinc-800/50 rounded-full p-1">
                            {SPEEDS.map(speed => (
                                <motion.button
                                    key={speed}
                                    className={`px-2 py-1 rounded-full text-xs font-medium transition-colors ${playbackSpeed === speed
                                        ? 'bg-violet-500 text-white'
                                        : 'text-zinc-400 hover:text-white'
                                        }`}
                                    onClick={() => onSpeedChange(speed)}
                                    whileHover={{ scale: 1.05 }}
                                    whileTap={{ scale: 0.95 }}
                                >
                                    {speed >= 1000 ? `${speed / 1000}k` : `${speed}x`}
                                </motion.button>
                            ))}
                            {/* Warp 超速按钮 */}
                            <motion.button
                                className={`px-3 py-1 rounded-full text-xs font-bold transition-colors ${playbackSpeed === WARP_SPEED
                                    ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-lg shadow-amber-500/30'
                                    : 'text-amber-400 hover:text-amber-300 hover:bg-amber-500/20'
                                    }`}
                                onClick={() => onSpeedChange(WARP_SPEED)}
                                whileHover={{ scale: 1.1 }}
                                whileTap={{ scale: 0.95 }}
                            >
                                ⚡ Warp
                            </motion.button>
                        </div>
                    </div>

                    {/* 右侧：快捷键提示 */}
                    <div className="flex items-center gap-3 text-xs text-zinc-500">
                        <span className="flex items-center gap-1">
                            <kbd className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">Space</kbd>
                            播放
                        </span>
                        <span className="flex items-center gap-1">
                            <kbd className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">←→</kbd>
                            跳转
                        </span>
                        <span className="flex items-center gap-1">
                            <kbd className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">Esc</kbd>
                            退出
                        </span>
                    </div>
                </div>
            </div>
        </motion.div>
    )
}
