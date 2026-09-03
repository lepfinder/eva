/**
 * 菜单栏托盘专属小票视图 (TrayReceiptView)
 * 极致紧凑、无多余黑框、全透明背景、失焦自闭
 */
import { useState, useEffect, useRef, useMemo } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { motion, AnimatePresence } from 'framer-motion'
import { toPng } from 'html-to-image'
import { Download, Copy, Check, Sparkles, RefreshCw, ExternalLink, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Barcode } from '@/components/Barcode'
import { formatDurationShort, balanceReceiptDurations } from '@/lib/receiptHelper'

interface AppStat {
    appName: string
    totalDuration: number
    percentage: number
}

interface ActivityLog {
    id: string
    appName: string
    windowTitle: string
    startTime: number
    endTime: number
    duration: number
}

function renderAsciiBar(percentage: number, maxBarLength = 6): string {
    const filledCount = Math.round((percentage / 100) * maxBarLength)
    const filled = '▓'.repeat(Math.max(0, Math.min(maxBarLength, filledCount)))
    const empty = '░'.repeat(Math.max(0, maxBarLength - filledCount))
    return filled + empty
}

const STAMP_OPTIONS = [
    { text: 'CLOCKED OUT', subtext: 'DOORS LOCKED', color: 'border-red-600 text-red-600' },
    { text: 'HARD WORKER', subtext: 'VERIFIED EFFORT', color: 'border-blue-600 text-blue-600' },
    { text: 'FOCUS BEAST', subtext: 'PEAK PRODUCTIVITY', color: 'border-emerald-600 text-emerald-600' },
    { text: 'TOUCH FISH', subtext: 'SURVIVED THE DAY', color: 'border-amber-600 text-amber-600' },
]

// 原生合成逼真的热敏纸撕裂音效（Web Audio 0 字节体积）
function playTearSound() {
    try {
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        const ctx = new AudioCtx()
        const duration = 0.09 // 90ms 脆性撕裂音
        const bufferSize = Math.floor(ctx.sampleRate * duration)
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate)
        const output = buffer.getChannelData(0)

        for (let i = 0; i < bufferSize; i++) {
            const decay = Math.exp(-i / (bufferSize * 0.35))
            output[i] = (Math.random() * 2 - 1) * decay
        }

        const whiteNoise = ctx.createBufferSource()
        whiteNoise.buffer = buffer

        const filter = ctx.createBiquadFilter()
        filter.type = 'bandpass'
        filter.frequency.value = 2200
        filter.Q.value = 1.6

        const gainNode = ctx.createGain()
        gainNode.gain.setValueAtTime(0.25, ctx.currentTime)
        gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration)

        whiteNoise.connect(filter)
        filter.connect(gainNode)
        gainNode.connect(ctx.destination)

        whiteNoise.start()
    } catch {
        // 音频上下文受限时静音降级
    }
}

// 仿真热敏打印微型步进电机走纸声
function playPrintSound() {
    try {
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        const ctx = new AudioCtx()
        const duration = 0.82
        const bufferSize = Math.floor(ctx.sampleRate * duration)
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate)
        const output = buffer.getChannelData(0)

        for (let i = 0; i < bufferSize; i++) {
            const t = i / ctx.sampleRate
            const pulse = (Math.sin(2 * Math.PI * 190 * t) > 0 ? 1 : -1) * 0.35
            const jitter = (Math.random() * 2 - 1) * 0.65
            output[i] = (pulse + jitter) * Math.exp(-i / (bufferSize * 0.85))
        }

        const source = ctx.createBufferSource()
        source.buffer = buffer

        const filter = ctx.createBiquadFilter()
        filter.type = 'bandpass'
        filter.frequency.value = 2600
        filter.Q.value = 1.8

        const gain = ctx.createGain()
        gain.gain.setValueAtTime(0.07, ctx.currentTime)
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration)

        source.connect(filter)
        filter.connect(gain)
        gain.connect(ctx.destination)

        source.start()
    } catch {
        // 静音降级
    }
}

export function TrayReceiptView() {
    const receiptRef = useRef<HTMLDivElement>(null)
    const [loading, setLoading] = useState(true)
    const [downloading, setDownloading] = useState(false)
    const [copying, setCopying] = useState(false)
    const [copied, setCopied] = useState(false)
    const [stampIndex, setStampIndex] = useState(0)
    const [stampAnimKey, setStampAnimKey] = useState(0)
    const [isTorn, setIsTorn] = useState(false)
    const [printKey, setPrintKey] = useState(0)

    const [stats, setStats] = useState<AppStat[]>([])
    const [totalDuration, setTotalDuration] = useState(0)
    const [logs, setLogs] = useState<ActivityLog[]>([])
    const [summary, setSummary] = useState('')

    const todayStr = useMemo(() => new Date().toISOString().split('T')[0], [])

    // 确保整个 WebView 背景 100% 透明，不留下白底
    useEffect(() => {
        document.documentElement.style.background = 'transparent'
        document.body.style.background = 'transparent'
        return () => {
            document.documentElement.style.background = ''
            document.body.style.background = ''
        }
    }, [])

    // 加载今日数据
    const loadTodayData = async () => {
        try {
            setLoading(true)
            const [s, t, l, sum] = await Promise.all([
                invoke<AppStat[]>('activity_get_today_stats', { date: todayStr }),
                invoke<number>('activity_get_today_total_duration', { date: todayStr }),
                invoke<ActivityLog[]>('activity_get_today_logs', { date: todayStr }),
                invoke<{ content: string } | null>('activity_get_daily_summary', { date: todayStr }).catch(() => null)
            ])
            setStats(s || [])
            setTotalDuration(t || 0)
            setLogs(l || [])
            if (sum && sum.content) {
                setSummary(sum.content)
            }
        } catch (e) {
            console.error('Failed to load tray receipt data:', e)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        playPrintSound()
        loadTodayData()
        const onFocus = () => {
            setIsTorn(false)
            setPrintKey(k => k + 1)
            playPrintSound()
            loadTodayData()
        }
        window.addEventListener('focus', onFocus)
        return () => window.removeEventListener('focus', onFocus)
    }, [])

    const receiptData = useMemo(() => {
        const sorted = [...stats].sort((a, b) => b.totalDuration - a.totalDuration)
        const topApps = sorted.slice(0, 5)
        const miscApps = sorted.slice(5)

        const miscDuration = miscApps.reduce((acc, curr) => acc + curr.totalDuration, 0)
        const miscPercentage = totalDuration > 0 ? Math.round((miscDuration / totalDuration) * 100) : 0
        const hasMisc = miscApps.length > 0

        // 配平展示项时长，确保各项相加 100% 精确等于小票 SUBTOTAL
        const itemDurations = topApps.map(a => a.totalDuration)
        if (hasMisc) {
            itemDurations.push(miscDuration)
        }
        const { itemFormatted, subtotalFormatted } = balanceReceiptDurations(itemDurations, totalDuration)

        const balancedTopApps = topApps.map((app, idx) => ({
            ...app,
            formattedDuration: itemFormatted[idx]
        }))
        const miscFormatted = hasMisc ? itemFormatted[itemFormatted.length - 1] : ''

        const biggestSink = balancedTopApps[0] || null

        let longestFocus: { appName: string; duration: number } | null = null
        if (logs.length > 0) {
            let maxLog = logs[0]
            for (const l of logs) {
                if (l.duration > maxLog.duration) maxLog = l
            }
            if (maxLog && maxLog.duration >= 60) {
                longestFocus = { appName: maxLog.appName, duration: maxLog.duration }
            }
        }

        let cleanAiSnippet = ''
        if (summary) {
            const firstLine = summary
                .replace(/^#+.*$/gm, '')
                .replace(/\*\*|__/g, '')
                .trim()
                .split('\n')
                .find(line => line.trim().length > 6)
            if (firstLine) {
                cleanAiSnippet = firstLine.slice(0, 60) + (firstLine.length > 60 ? '...' : '')
            }
        }

        const dateObj = new Date()
        const dateFormatted = dateObj.toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: '2-digit',
            year: 'numeric'
        }).toUpperCase()

        return {
            topApps: balancedTopApps,
            hasMisc,
            miscCount: miscApps.length,
            miscDuration,
            miscPercentage,
            miscFormatted,
            subtotalFormatted,
            biggestSink,
            longestFocus,
            cleanAiSnippet,
            dateFormatted,
            logCount: logs.length
        }
    }, [stats, logs, totalDuration, summary])

    // 保存 PNG
    const handleDownloadPng = async () => {
        if (!receiptRef.current) return
        try {
            setDownloading(true)
            const dataUrl = await toPng(receiptRef.current, {
                quality: 0.98,
                pixelRatio: 2.5,
                backgroundColor: '#18181b', // 导出时衬底深色背景
            })
            const link = document.createElement('a')
            link.download = `eva-receipt-${todayStr}.png`
            link.href = dataUrl
            link.click()
        } catch (err) {
            console.error('Failed to export receipt image:', err)
        } finally {
            setDownloading(false)
        }
    }

    // 复制图片到剪贴板
    const handleCopyImage = async () => {
        if (!receiptRef.current || copying) return
        try {
            setCopying(true)
            const dataUrl = await toPng(receiptRef.current, {
                quality: 0.98,
                pixelRatio: 2.5,
                backgroundColor: '#18181b',
            })

            let success = false
            try {
                success = await invoke<boolean>('clipboard_write_image_data', { dataBase64: dataUrl })
            } catch (e) {
                console.warn('Native clipboard failed:', e)
            }

            if (!success && navigator.clipboard && window.ClipboardItem) {
                const res = await fetch(dataUrl)
                const blob = await res.blob()
                await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
                success = true
            }

            if (success) {
                setCopied(true)
                setTimeout(() => setCopied(false), 2000)
            }
        } catch (err) {
            console.error('Failed to copy receipt:', err)
        } finally {
            setCopying(false)
        }
    }

    const cycleStamp = () => {
        setStampIndex((prev) => (prev + 1) % STAMP_OPTIONS.length)
        setStampAnimKey((prev) => prev + 1)
    }

    const handleClose = async () => {
        try {
            await invoke('tray_hide_receipt_window')
        } catch {
            window.close()
        }
    }

    // 撕下小票动效与音效
    const handleTearOff = () => {
        if (isTorn) return
        playTearSound()
        setIsTorn(true)
        setTimeout(() => {
            handleClose()
        }, 360)
    }

    const handleOpenMainWindow = async () => {
        try {
            await invoke('open_main_window')
        } catch (e) {
            console.error('Failed to open main window:', e)
        }
    }

    const currentStamp = STAMP_OPTIONS[stampIndex]

    return (
        <div className="w-full h-screen max-h-screen bg-transparent p-2.5 pb-2 select-none flex flex-col justify-between overflow-hidden font-sans box-border">
            {/* 小票主体容器：flex-1 自适应撑满垂直空间，带有柔和的高斯拟物悬浮投影 */}
            <div
                ref={receiptRef}
                className="w-full flex-1 min-h-0 flex flex-col relative drop-shadow-[0_12px_24px_rgba(0,0,0,0.35)]"
            >
                {/* 打印机槽口 (Feeder Head) - 紧贴纸张 */}
                <div className="w-full shrink-0 bg-zinc-900 border border-zinc-700/80 rounded-t-lg px-3 py-1.5 flex items-center justify-between relative z-10">
                    <div className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.9)] animate-pulse" />
                        <span className="font-mono text-[9px] tracking-widest text-zinc-300 font-bold uppercase">
                            EVA-P80 PRINTER
                        </span>
                    </div>

                    <div className="flex items-center gap-1">
                        <button
                            onClick={loadTodayData}
                            className="text-zinc-400 hover:text-white p-0.5 rounded transition-colors"
                            title="刷新今日数据"
                        >
                            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
                        </button>
                        <button
                            onClick={handleClose}
                            className="text-zinc-400 hover:text-white p-0.5 rounded transition-colors"
                            title="收起小票"
                        >
                            <X className="w-3 h-3" />
                        </button>
                    </div>

                    {/* 出纸口黑缝 */}
                    <div className="absolute -bottom-0.5 left-2 right-2 h-1 bg-black/90 rounded-full" />
                </div>

                {/* 撕纸拖拽层：向下拖拽小票触发物理断纸自由落体 */}
                <motion.div
                    key={printKey}
                    drag={isTorn ? false : "y"}
                    dragDirectionLock
                    dragConstraints={{ top: 0, bottom: 0 }}
                    dragElastic={{ top: 0.04, bottom: 0.55 }}
                    onDragEnd={(_, info) => {
                        if (info.offset.y > 65 || info.velocity.y > 280) {
                            handleTearOff()
                        }
                    }}
                    initial={{ clipPath: 'inset(0 0 100% 0)' }}
                    animate={
                        isTorn
                            ? { y: 480, rotate: 12, opacity: 0, clipPath: 'inset(0 0 0% 0)' }
                            : { y: 0, rotate: 0, opacity: 1, clipPath: 'inset(0 0 0% 0)' }
                    }
                    transition={
                        isTorn
                            ? { duration: 0.36, ease: [0.32, 0, 0.67, 0] }
                            : { clipPath: { duration: 0.85, ease: [0.12, 0.7, 0.25, 1] }, type: 'spring', damping: 22, stiffness: 350 }
                    }
                    className="w-full flex-1 min-h-0 flex flex-col cursor-grab active:cursor-grabbing origin-top"
                >
                    {/* 热敏纸张主体 */}
                    <div
                        className="w-full flex-1 min-h-0 flex flex-col justify-between bg-[#fcfaf2] text-[#1a1a1a] font-mono px-3.5 pt-3 pb-2 relative overflow-hidden tracking-tight text-[10px] leading-tight border-x border-[#ebe6d8]"
                    >
                    {/* 纸张细微横向压纹 */}
                    <div
                        className="absolute inset-0 opacity-[0.03] pointer-events-none"
                        style={{
                            backgroundImage: 'repeating-linear-gradient(0deg, #000, #000 1px, transparent 1px, transparent 4px)'
                        }}
                    />

                    {/* 纸张上半部内容区 */}
                    <div className="flex flex-col shrink-0">
                        {/* Header */}
                        <div className="text-center mb-1.5">
                            <div className="text-xs font-bold tracking-widest">★ ★ ★ EVA RECEIPT ★ ★ ★</div>
                            <div className="text-[9px] text-zinc-600 tracking-wider">YOUR DAY, ITEMIZED</div>
                        </div>

                        {/* 元信息 */}
                        <div className="border-b border-dashed border-zinc-400 pb-1 mb-1.5 text-[9px] text-zinc-600 leading-normal">
                            <div className="flex justify-between">
                                <span>{receiptData.dateFormatted}</span>
                                <span>{new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}</span>
                            </div>
                            <div className="flex justify-between">
                                <span>CASHIER: YOU</span>
                                <span>REGISTER: macOS</span>
                            </div>
                        </div>

                        {/* 表头 */}
                        <div className="font-bold flex justify-between border-b border-dashed border-zinc-400 pb-0.5 mb-1.5 text-zinc-700">
                            <span className="w-4">#</span>
                            <span className="flex-1 text-left px-1">ITEM</span>
                            <span className="w-12 text-center">BAR</span>
                            <span className="w-12 text-right">TIME</span>
                        </div>

                        {/* 明细条目 */}
                        <div className="space-y-1 mb-1.5">
                            {receiptData.topApps.map((item, idx) => (
                                <div key={item.appName} className="flex justify-between items-center">
                                    <span className="w-4 text-zinc-500 font-semibold">{idx + 1}</span>
                                    <span className="flex-1 truncate font-medium pr-1" title={item.appName}>
                                        {item.appName}
                                    </span>
                                    <span className="w-12 text-center tracking-tighter text-[9px] text-zinc-700 font-bold">
                                        {renderAsciiBar(item.percentage)}
                                    </span>
                                    <span className="w-12 text-right font-semibold">
                                        {item.formattedDuration}
                                    </span>
                                </div>
                            ))}

                            {receiptData.hasMisc && (
                                <div className="flex justify-between items-center text-zinc-600 italic">
                                    <span className="w-4">+</span>
                                    <span className="flex-1 truncate pr-1">
                                        MISC ({receiptData.miscCount} APPS)
                                    </span>
                                    <span className="w-12 text-center tracking-tighter text-[9px]">
                                        {renderAsciiBar(receiptData.miscPercentage)}
                                    </span>
                                    <span className="w-12 text-right font-semibold">
                                        {receiptData.miscFormatted}
                                    </span>
                                </div>
                            )}
                        </div>

                        {/* 统计指标 */}
                        <div className="border-t border-dashed border-zinc-400 pt-1.5 mb-1.5 space-y-0.5 text-[9px]">
                            {receiptData.biggestSink && (
                                <div className="flex justify-between items-center">
                                    <span className="text-zinc-600">TIME SINK:</span>
                                    <span className="font-semibold truncate max-w-[150px] text-right">
                                        {receiptData.biggestSink.appName} ({receiptData.biggestSink.formattedDuration})
                                    </span>
                                </div>
                            )}
                            {receiptData.longestFocus && (
                                <div className="flex justify-between items-center">
                                    <span className="text-zinc-600">FOCUS RUN:</span>
                                    <span className="font-semibold truncate max-w-[150px] text-right">
                                        {receiptData.longestFocus.appName} ({formatDurationShort(receiptData.longestFocus.duration)})
                                    </span>
                                </div>
                            )}
                            <div className="flex justify-between items-center">
                                <span className="text-zinc-600">SWITCHES:</span>
                                <span className="font-semibold">{receiptData.logCount} SESSIONS</span>
                            </div>
                        </div>

                        {/* 结算 */}
                        <div className="border-t-2 border-zinc-800 pt-1.5 mb-1.5">
                            <div className="flex justify-between text-[11px] font-bold">
                                <span>SUBTOTAL</span>
                                <span>{receiptData.subtotalFormatted}</span>
                            </div>
                            <div className="text-[8px] text-zinc-500 uppercase tracking-widest mt-0.5">
                                DOORS LOCKED. GO HOME.
                            </div>
                        </div>

                        {/* AI 每日总结 */}
                        {receiptData.cleanAiSnippet && (
                            <div className="bg-amber-100/70 border border-amber-300/80 rounded p-1.5 text-[9px] text-amber-900 leading-snug mb-1">
                                <div className="font-bold flex items-center gap-1 text-[8px] text-amber-950 mb-0.5">
                                    <Sparkles className="w-2.5 h-2.5 text-amber-600" />
                                    EVA NOTE:
                                </div>
                                "{receiptData.cleanAiSnippet}"
                            </div>
                        )}
                    </div>

                    {/* 纸张中间弹性伸展区：印章居中展示，自然吸收页面垂直余量 */}
                    <div className="flex-1 min-h-[44px] flex items-center justify-center py-1 cursor-pointer" onClick={cycleStamp} title="点击更换印章">
                        <AnimatePresence mode="wait">
                            <motion.div
                                key={`${stampAnimKey}-${printKey}`}
                                initial={{ scale: 1.8, opacity: 0, rotate: -18 }}
                                animate={{ scale: 1, opacity: 0.9, rotate: -6 }}
                                exit={{ scale: 0.8, opacity: 0 }}
                                transition={{ delay: 0.82, type: 'spring', damping: 14, stiffness: 240 }}
                                className={`border-2 border-double px-3.5 py-0.5 rounded text-center select-none ${currentStamp.color}`}
                            >
                                <div className="text-xs font-black tracking-widest leading-none">
                                    {currentStamp.text}
                                </div>
                                <div className="text-[7px] font-bold tracking-wider mt-0.5 opacity-80">
                                    ★ {currentStamp.subtext} ★
                                </div>
                            </motion.div>
                        </AnimatePresence>
                    </div>

                    {/* 纸张底部的条形码 & 编号 */}
                    <div className="shrink-0 pt-1.5 border-t border-dashed border-zinc-400 text-center flex flex-col items-center">
                        <Barcode
                            value={`${todayStr.replace(/-/g, '')}-EVA`}
                            height={24}
                            narrowWidth={1.1}
                            wideRatio={2.3}
                            className="my-0.5"
                        />
                        <div className="text-[8px] tracking-widest text-zinc-500 mb-0.5">
                            NO. {todayStr.replace(/-/g, '')}-EVA
                        </div>
                        <div className="text-[8px] font-bold text-zinc-700">
                            THANK YOU FOR WORKING WITH YOURSELF
                        </div>
                    </div>
                    </div>

                    {/* 底部真实切纸锯齿边 (Sawtooth Cut) */}
                    <div className="w-full shrink-0 h-2.5 overflow-hidden text-[#fcfaf2]">
                        <svg viewBox="0 0 120 4" preserveAspectRatio="none" className="w-full h-full fill-current">
                            <polygon points="
                                0,0 2,4 4,0 6,4 8,0 10,4 12,0 14,4 16,0 18,4 20,0 22,4 24,0 26,4 28,0 30,4
                                32,0 34,4 36,0 38,4 40,0 42,4 44,0 46,4 48,0 50,4 52,0 54,4 56,0 58,4 60,0
                                62,4 64,0 66,4 68,0 70,4 72,0 74,4 76,0 78,4 80,0 82,4 84,0 86,4 88,0 90,4
                                92,0 94,4 96,0 98,4 100,0 102,4 104,0 106,4 108,0 110,4 112,0 114,4 116,0 118,4 120,0
                            " />
                        </svg>
                    </div>
                </motion.div>
            </div>

            {/* 撕纸操作引导文案 */}
            <div className="text-[8px] font-mono tracking-widest text-amber-500/80 uppercase text-center mt-1 select-none flex items-center justify-center gap-1">
                <span>↓</span> DRAG DOWN TO TEAR IT OFF
            </div>

            {/* 紧紧吸附在窗口最底部的操作栏 */}
            <div className="w-full shrink-0 mt-1.5 flex items-center justify-between gap-1.5 px-0.5">
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleOpenMainWindow}
                    className="text-[11px] text-zinc-400 hover:text-white hover:bg-zinc-800/70 h-7 px-2 gap-1 rounded-md"
                    title="进入 EVA 大窗口完整面板"
                >
                    <ExternalLink className="w-3 h-3" />
                    EVA 面板
                </Button>

                <div className="flex items-center gap-1.5">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={handleCopyImage}
                        disabled={copying}
                        className="text-[11px] bg-zinc-900/90 border-zinc-700 text-zinc-300 hover:text-white hover:bg-zinc-800 h-7 px-2 gap-1 shadow-sm"
                    >
                        {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                        {copied ? '已复制' : copying ? '...' : '复制'}
                    </Button>

                    <Button
                        size="sm"
                        onClick={handleDownloadPng}
                        disabled={downloading}
                        className="text-[11px] bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-medium h-7 px-2.5 gap-1 shadow-sm shadow-orange-500/20"
                    >
                        <Download className="w-3 h-3" />
                        {downloading ? '...' : '保存小票'}
                    </Button>
                </div>
            </div>
        </div>
    )
}
