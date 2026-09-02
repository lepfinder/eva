/**
 * 时间小票（Time Receipt）组件
 * 灵感源自 Punchcard：把一天的屏幕时间具象化为一张复古热敏消费小票
 */
import { useState, useRef, useMemo } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { motion, AnimatePresence } from 'framer-motion'
import { toPng } from 'html-to-image'
import { Download, Copy, Check, Sparkles, RefreshCw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogOverlay, DialogPortal } from '@/components/ui/dialog'
import { Barcode } from '@/components/Barcode'

export interface TimeReceiptProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    selectedDate: string
    totalDuration: number
    appStats: Array<{ appName: string; totalDuration: number; percentage: number }>
    logs?: Array<{ appName: string; windowTitle: string; startTime: number; endTime: number; duration: number }>
    summary?: string
}

// 格式化时长为英文简写（如 3h 12m）
function formatDurationShort(seconds: number): string {
    if (seconds < 60) return `${seconds}s`
    const hours = Math.floor(seconds / 3600)
    const mins = Math.floor((seconds % 3600) / 60)
    if (hours === 0) return `${mins}m`
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
}

// 生成 6 位等宽字符柱状图 (例如 ▓▓▓░░░)
function renderAsciiBar(percentage: number, maxBarLength = 6): string {
    const filledCount = Math.round((percentage / 100) * maxBarLength)
    const filled = '▓'.repeat(Math.max(0, Math.min(maxBarLength, filledCount)))
    const empty = '░'.repeat(Math.max(0, maxBarLength - filledCount))
    return filled + empty
}

// 印章选项
const STAMP_OPTIONS = [
    { text: 'CLOCKED OUT', subtext: 'DOORS LOCKED', color: 'border-red-600 text-red-600' },
    { text: 'HARD WORKER', subtext: 'VERIFIED EFFORT', color: 'border-blue-600 text-blue-600' },
    { text: 'FOCUS BEAST', subtext: 'PEAK PRODUCTIVITY', color: 'border-emerald-600 text-emerald-600' },
    { text: 'TOUCH FISH', subtext: 'SURVIVED THE DAY', color: 'border-amber-600 text-amber-600' },
]

export function TimeReceipt({
    open,
    onOpenChange,
    selectedDate,
    totalDuration,
    appStats,
    logs = [],
    summary = ''
}: TimeReceiptProps) {
    const receiptRef = useRef<HTMLDivElement>(null)
    const [downloading, setDownloading] = useState(false)
    const [copying, setCopying] = useState(false)
    const [copied, setCopied] = useState(false)
    const [stampIndex, setStampIndex] = useState(0)
    const [stampAnimKey, setStampAnimKey] = useState(0)

    // 数据清洗与格式化
    const receiptData = useMemo(() => {
        // TOP 6 应用，其余合并为 MISC
        const sorted = [...appStats].sort((a, b) => b.totalDuration - a.totalDuration)
        const topApps = sorted.slice(0, 6)
        const miscApps = sorted.slice(6)

        const miscDuration = miscApps.reduce((acc, curr) => acc + curr.totalDuration, 0)
        const miscPercentage = totalDuration > 0 ? Math.round((miscDuration / totalDuration) * 100) : 0

        // 最大时间黑洞
        const biggestSink = topApps[0] || null

        // 最长专注记录（单次未打断时长）
        let longestFocus: { appName: string; duration: number } | null = null
        if (logs.length > 0) {
            let maxLog = logs[0]
            for (const l of logs) {
                if (l.duration > maxLog.duration) {
                    maxLog = l
                }
            }
            if (maxLog && maxLog.duration >= 60) {
                longestFocus = { appName: maxLog.appName, duration: maxLog.duration }
            }
        }

        // 提取 AI 总结的一两句话
        let cleanAiSnippet = ''
        if (summary) {
            const firstLine = summary
                .replace(/^#+.*$/gm, '')
                .replace(/\*\*|__/g, '')
                .trim()
                .split('\n')
                .find(line => line.trim().length > 6)
            if (firstLine) {
                cleanAiSnippet = firstLine.slice(0, 80) + (firstLine.length > 80 ? '...' : '')
            }
        }

        // 格式化日期星期
        const dateObj = new Date(selectedDate + 'T12:00:00')
        const dateFormatted = dateObj.toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: '2-digit',
            year: 'numeric'
        }).toUpperCase()

        return {
            topApps,
            hasMisc: miscApps.length > 0,
            miscCount: miscApps.length,
            miscDuration,
            miscPercentage,
            biggestSink,
            longestFocus,
            cleanAiSnippet,
            dateFormatted,
            logCount: logs.length
        }
    }, [appStats, logs, totalDuration, selectedDate, summary])

    // 保存为 PNG 图片
    const handleDownloadPng = async () => {
        if (!receiptRef.current) return
        try {
            setDownloading(true)
            const dataUrl = await toPng(receiptRef.current, {
                quality: 0.98,
                pixelRatio: 2.5,
                backgroundColor: '#09090b', // 外围暗色背景衬托小票
            })
            const link = document.createElement('a')
            link.download = `eva-receipt-${selectedDate}.png`
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
                backgroundColor: '#09090b',
            })

            // 优先使用 Tauri 原生剪贴板通道（绕过 WebKit 沙箱，原生各应用秒粘贴）
            let success = false
            try {
                success = await invoke<boolean>('clipboard_write_image_data', { dataBase64: dataUrl })
            } catch (invokeErr) {
                console.warn('Tauri clipboard invoke failed, fallback to Web API:', invokeErr)
            }

            // Fallback: 浏览器 Clipboard API
            if (!success && navigator.clipboard && window.ClipboardItem) {
                const res = await fetch(dataUrl)
                const blob = await res.blob()
                await navigator.clipboard.write([
                    new ClipboardItem({ 'image/png': blob })
                ])
                success = true
            }

            if (success) {
                setCopied(true)
                setTimeout(() => setCopied(false), 2000)
            }
        } catch (err) {
            console.error('Failed to copy receipt to clipboard:', err)
        } finally {
            setCopying(false)
        }
    }

    // 切换印章
    const cycleStamp = () => {
        setStampIndex((prev) => (prev + 1) % STAMP_OPTIONS.length)
        setStampAnimKey((prev) => prev + 1)
    }

    const currentStamp = STAMP_OPTIONS[stampIndex]

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogPortal>
                <DialogOverlay className="bg-black/75 backdrop-blur-sm" />
                <DialogContent className="max-w-[420px] p-0 border-none bg-transparent shadow-none overflow-visible focus:outline-none">
                    {/* 关闭按钮 */}
                    <button
                        onClick={() => onOpenChange(false)}
                        className="absolute -top-10 right-0 text-zinc-400 hover:text-white transition-colors p-1"
                        title="关闭 (Esc)"
                    >
                        <X className="w-5 h-5" />
                    </button>

                    {/* 打印机整体机身与出纸动画 */}
                    <div className="flex flex-col items-center select-none">
                        {/* 打印机槽口 (Feeder Slot) */}
                        <div className="w-full bg-gradient-to-b from-zinc-800 to-zinc-900 border border-zinc-700/80 rounded-t-xl px-4 py-2.5 flex items-center justify-between shadow-2xl relative z-20">
                            <div className="flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)] animate-pulse" />
                                <span className="font-mono text-[10px] tracking-widest text-zinc-400 uppercase font-semibold">
                                    EVA-P80 THERMAL PRINTER
                                </span>
                            </div>
                            <span className="font-mono text-[10px] text-zinc-500">READY</span>
                            {/* 黑色下凹出纸缝 */}
                            <div className="absolute -bottom-1 left-4 right-4 h-1.5 bg-black/90 rounded-full shadow-inner" />
                        </div>

                        {/* 小票包裹层（可截屏节点） */}
                        <div ref={receiptRef} className="w-full bg-zinc-950 p-3 pt-1">
                            <motion.div
                                initial={{ clipPath: 'inset(0 0 100% 0)' }}
                                animate={{ clipPath: 'inset(0 0 0% 0)' }}
                                transition={{ duration: 0.85, ease: [0.12, 0.7, 0.25, 1] }}
                                className="w-full relative shadow-[0_20px_50px_rgba(0,0,0,0.5)] origin-top"
                            >
                                {/* 热敏票纸主体 */}
                                <div className="bg-[#fcfaf2] text-[#1a1a1a] font-mono px-5 pt-6 pb-4 relative overflow-hidden tracking-tight selection:bg-amber-200">
                                    {/* 复古纸张横向细压纹 */}
                                    <div
                                        className="absolute inset-0 opacity-[0.03] pointer-events-none"
                                        style={{
                                            backgroundImage: 'repeating-linear-gradient(0deg, #000, #000 1px, transparent 1px, transparent 4px)'
                                        }}
                                    />

                                    {/* Header 抬头 */}
                                    <div className="text-center mb-4">
                                        <div className="text-sm font-bold tracking-widest">★ ★ ★ EVA RECEIPT ★ ★ ★</div>
                                        <div className="text-[11px] text-zinc-600 tracking-wider mt-0.5">
                                            YOUR DAY, ITEMIZED
                                        </div>
                                    </div>

                                    {/* 票据元信息 */}
                                    <div className="text-[11px] leading-relaxed border-b border-dashed border-zinc-400 pb-2 mb-3">
                                        <div className="flex justify-between">
                                            <span>{receiptData.dateFormatted}</span>
                                            <span>{new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}</span>
                                        </div>
                                        <div className="flex justify-between text-zinc-600">
                                            <span>CASHIER: YOU</span>
                                            <span>REGISTER: macOS</span>
                                        </div>
                                    </div>

                                    {/* 表头 */}
                                    <div className="text-[11px] font-bold flex justify-between border-b border-dashed border-zinc-400 pb-1 mb-2 text-zinc-700">
                                        <span className="w-6">QTY</span>
                                        <span className="flex-1 text-left px-1">ITEM</span>
                                        <span className="w-14 text-center">BAR</span>
                                        <span className="w-14 text-right">TIME</span>
                                    </div>

                                    {/* 明细列表 */}
                                    <div className="text-[11px] leading-snug space-y-1.5 mb-3">
                                        {receiptData.topApps.map((item, idx) => (
                                            <div key={item.appName} className="flex justify-between items-center group">
                                                <span className="w-6 text-zinc-500 font-semibold">{idx + 1}</span>
                                                <span className="flex-1 truncate font-medium pr-1" title={item.appName}>
                                                    {item.appName}
                                                </span>
                                                <span className="w-14 text-center tracking-tighter text-[10px] text-zinc-700 font-bold">
                                                    {renderAsciiBar(item.percentage)}
                                                </span>
                                                <span className="w-14 text-right font-semibold">
                                                    {formatDurationShort(item.totalDuration)}
                                                </span>
                                            </div>
                                        ))}

                                        {receiptData.hasMisc && (
                                            <div className="flex justify-between items-center text-zinc-600 italic">
                                                <span className="w-6 font-semibold">+</span>
                                                <span className="flex-1 truncate pr-1">
                                                    MISC ({receiptData.miscCount} OTHER APPS)
                                                </span>
                                                <span className="w-14 text-center tracking-tighter text-[10px]">
                                                    {renderAsciiBar(receiptData.miscPercentage)}
                                                </span>
                                                <span className="w-14 text-right font-semibold">
                                                    {formatDurationShort(receiptData.miscDuration)}
                                                </span>
                                            </div>
                                        )}
                                    </div>

                                    {/* 统计指标卡 */}
                                    <div className="border-t border-dashed border-zinc-400 pt-2.5 mb-3 text-[11px] space-y-1">
                                        {receiptData.biggestSink && (
                                            <div className="flex justify-between items-center">
                                                <span className="text-zinc-600">BIGGEST TIME SINK:</span>
                                                <span className="font-semibold truncate max-w-[170px] text-right">
                                                    {receiptData.biggestSink.appName} ({formatDurationShort(receiptData.biggestSink.totalDuration)})
                                                </span>
                                            </div>
                                        )}
                                        {receiptData.longestFocus && (
                                            <div className="flex justify-between items-center">
                                                <span className="text-zinc-600">LONGEST FOCUS RUN:</span>
                                                <span className="font-semibold truncate max-w-[170px] text-right">
                                                    {receiptData.longestFocus.appName} ({formatDurationShort(receiptData.longestFocus.duration)})
                                                </span>
                                            </div>
                                        )}
                                        <div className="flex justify-between items-center">
                                            <span className="text-zinc-600">APP SWITCHES:</span>
                                            <span className="font-semibold">{receiptData.logCount} SESSIONS</span>
                                        </div>
                                    </div>

                                    {/* 总结结算 */}
                                    <div className="border-t-2 border-zinc-800 pt-2 mb-4 text-[11px]">
                                        <div className="flex justify-between text-xs font-bold mb-1">
                                            <span>SUBTOTAL</span>
                                            <span>{formatDurationShort(totalDuration)}</span>
                                        </div>
                                        <div className="text-[10px] font-semibold text-zinc-700 leading-tight">
                                            TOTAL: 1 (ONE) WORKDAY
                                        </div>
                                        <div className="text-[9px] text-zinc-500 uppercase tracking-widest mt-0.5">
                                            DOORS LOCKED. LIGHTS OFF. GO HOME.
                                        </div>
                                    </div>

                                    {/* AI 每日箴言（若存在） */}
                                    {receiptData.cleanAiSnippet && (
                                        <div className="bg-amber-100/70 border border-amber-300/80 rounded p-2 text-[10px] text-amber-900 leading-relaxed mb-4">
                                            <div className="font-bold flex items-center gap-1 text-[10px] mb-0.5 text-amber-950">
                                                <Sparkles className="w-3 h-3 text-amber-600" />
                                                EVA COPILOT NOTE:
                                            </div>
                                            "{receiptData.cleanAiSnippet}"
                                        </div>
                                    )}

                                    {/* 印章盖戳 (Stamp) */}
                                    <div className="my-2 flex justify-center cursor-pointer" onClick={cycleStamp} title="点击更换印章">
                                        <AnimatePresence mode="wait">
                                            <motion.div
                                                key={stampAnimKey}
                                                initial={{ scale: 1.8, opacity: 0, rotate: -20 }}
                                                animate={{ scale: 1, opacity: 0.9, rotate: -8 }}
                                                exit={{ scale: 0.8, opacity: 0 }}
                                                transition={{ delay: 0.82, type: 'spring', damping: 14, stiffness: 220 }}
                                                className={`border-4 border-double px-4 py-1 rounded text-center select-none ${currentStamp.color}`}
                                            >
                                                <div className="text-base font-black tracking-widest leading-none">
                                                    {currentStamp.text}
                                                </div>
                                                <div className="text-[8px] font-bold tracking-wider mt-0.5 opacity-80">
                                                    ★ {currentStamp.subtext} ★
                                                </div>
                                            </motion.div>
                                        </AnimatePresence>
                                    </div>

                                    {/* 条形码 & 底部文字 */}
                                    <div className="mt-4 pt-3 border-t border-dashed border-zinc-400 text-center flex flex-col items-center">
                                        <Barcode
                                            value={`${selectedDate.replace(/-/g, '')}-EVA`}
                                            height={34}
                                            narrowWidth={1.25}
                                            wideRatio={2.4}
                                            className="my-1.5"
                                        />
                                        <div className="text-[10px] tracking-widest text-zinc-600 mb-2">
                                            NO. {selectedDate.replace(/-/g, '')}-EVA
                                        </div>

                                        <div className="text-[10px] font-bold tracking-wider text-zinc-800">
                                            THANK YOU FOR WORKING WITH YOURSELF
                                        </div>
                                        <div className="text-[9px] text-zinc-500 mt-0.5">
                                            printed with ♥ by EVA
                                        </div>
                                    </div>
                                </div>

                                {/* 底部撕纸锯齿边缘 (CSS SVG Sawtooth Cut) */}
                                <div className="w-full h-3 overflow-hidden text-[#fcfaf2]">
                                    <svg
                                        viewBox="0 0 120 4"
                                        preserveAspectRatio="none"
                                        className="w-full h-full fill-current"
                                    >
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

                        {/* 底部操作工具条 */}
                        <div className="w-full mt-3 flex items-center justify-between gap-2 px-2">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={cycleStamp}
                                className="text-xs bg-zinc-900 border-zinc-700 text-zinc-300 hover:text-white hover:bg-zinc-800 h-8 gap-1.5"
                            >
                                <RefreshCw className="w-3.5 h-3.5" />
                                换个印章
                            </Button>

                            <div className="flex items-center gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={handleCopyImage}
                                    disabled={copying}
                                    className="text-xs bg-zinc-900 border-zinc-700 text-zinc-300 hover:text-white hover:bg-zinc-800 h-8 gap-1.5"
                                >
                                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                                    {copied ? '已复制' : copying ? '复制中...' : '复制小票'}
                                </Button>

                                <Button
                                    size="sm"
                                    onClick={handleDownloadPng}
                                    disabled={downloading}
                                    className="text-xs bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-medium h-8 gap-1.5 shadow-lg shadow-orange-500/25"
                                >
                                    <Download className="w-3.5 h-3.5" />
                                    {downloading ? '导出中...' : '保存小票'}
                                </Button>
                            </div>
                        </div>
                    </div>
                </DialogContent>
            </DialogPortal>
        </Dialog>
    )
}
