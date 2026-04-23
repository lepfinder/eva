/**
 * 时间戳工具组件
 * 支持时间戳与格式化时间互转，秒/毫秒切换
 */
import { useState, useEffect, useCallback } from 'react'
import {
    Clock,
    Copy,
    Check,
    RefreshCw,
    ArrowRight,
    ArrowLeft
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export function TimestampConverter(): React.ReactElement {
    // 当前时间戳（实时更新）
    const [currentTimestamp, setCurrentTimestamp] = useState(Date.now())
    const [useMilliseconds, setUseMilliseconds] = useState(true)

    // 时间戳转时间
    const [inputTimestamp, setInputTimestamp] = useState('')
    const [convertedTime, setConvertedTime] = useState('')
    const [timestampError, setTimestampError] = useState('')

    // 时间转时间戳
    const [inputTime, setInputTime] = useState('')
    const [convertedTimestamp, setConvertedTimestamp] = useState('')
    const [timeError, setTimeError] = useState('')

    // 复制状态
    const [copiedStates, setCopiedStates] = useState<Record<string, boolean>>({})

    // 实时更新当前时间戳
    useEffect(() => {
        const timer = setInterval(() => {
            setCurrentTimestamp(Date.now())
        }, 100)
        return () => clearInterval(timer)
    }, [])

    // 格式化时间戳显示
    const formatTimestamp = useCallback((ts: number) => {
        return useMilliseconds ? ts : Math.floor(ts / 1000)
    }, [useMilliseconds])

    // 格式化日期时间
    const formatDateTime = useCallback((date: Date) => {
        const pad = (n: number) => n.toString().padStart(2, '0')
        const y = date.getFullYear()
        const m = pad(date.getMonth() + 1)
        const d = pad(date.getDate())
        const h = pad(date.getHours())
        const min = pad(date.getMinutes())
        const s = pad(date.getSeconds())
        const ms = date.getMilliseconds().toString().padStart(3, '0')
        return useMilliseconds
            ? `${y}-${m}-${d} ${h}:${min}:${s}.${ms}`
            : `${y}-${m}-${d} ${h}:${min}:${s}`
    }, [useMilliseconds])

    // 复制到剪贴板
    const copyToClipboard = async (text: string, key: string) => {
        try {
            await navigator.clipboard.writeText(text)
            setCopiedStates(prev => ({ ...prev, [key]: true }))
            setTimeout(() => {
                setCopiedStates(prev => ({ ...prev, [key]: false }))
            }, 2000)
        } catch (err) {
            console.error('复制失败:', err)
        }
    }

    // 时间戳转时间
    const convertTimestampToTime = useCallback(() => {
        if (!inputTimestamp.trim()) {
            setConvertedTime('')
            setTimestampError('')
            return
        }

        try {
            let ts = parseInt(inputTimestamp.trim(), 10)
            if (isNaN(ts)) {
                throw new Error('无效的时间戳')
            }

            // 自动判断是秒还是毫秒
            if (ts < 10000000000) {
                // 小于 10 位数，认为是秒
                ts = ts * 1000
            }

            const date = new Date(ts)
            if (isNaN(date.getTime())) {
                throw new Error('无效的时间戳')
            }

            setConvertedTime(formatDateTime(date))
            setTimestampError('')
        } catch (err) {
            setConvertedTime('')
            setTimestampError(err instanceof Error ? err.message : '转换失败')
        }
    }, [inputTimestamp, formatDateTime])

    // 时间转时间戳
    const convertTimeToTimestamp = useCallback(() => {
        if (!inputTime.trim()) {
            setConvertedTimestamp('')
            setTimeError('')
            return
        }

        try {
            const date = new Date(inputTime.trim())
            if (isNaN(date.getTime())) {
                throw new Error('无效的时间格式')
            }

            const ts = date.getTime()
            setConvertedTimestamp(formatTimestamp(ts).toString())
            setTimeError('')
        } catch (err) {
            setConvertedTimestamp('')
            setTimeError(err instanceof Error ? err.message : '转换失败')
        }
    }, [inputTime, formatTimestamp])

    // 获取当前时间的格式化字符串
    const currentTimeFormatted = formatDateTime(new Date(currentTimestamp))
    const currentTimestampDisplay = formatTimestamp(currentTimestamp).toString()

    // 填充当前时间戳到输入框
    const fillCurrentTimestamp = () => {
        setInputTimestamp(currentTimestampDisplay)
    }

    // 填充当前时间到输入框
    const fillCurrentTime = () => {
        setInputTime(currentTimeFormatted)
    }

    return (
        <TooltipProvider delayDuration={300}>
            <div className="h-full flex flex-col gap-6">
                {/* 当前时间卡片 */}
                <Card>
                    <CardHeader className="pb-3">
                        <CardTitle className="flex items-center gap-2 text-lg">
                            <Clock className="h-5 w-5" />
                            当前时间
                            <div className="flex items-center gap-2 ml-auto">
                                <Label htmlFor="use-ms" className="text-sm font-normal text-muted-foreground">
                                    毫秒
                                </Label>
                                <Switch
                                    id="use-ms"
                                    checked={useMilliseconds}
                                    onCheckedChange={setUseMilliseconds}
                                />
                            </div>
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="grid grid-cols-2 gap-6">
                            {/* 时间戳 */}
                            <div className="space-y-2">
                                <Label className="text-muted-foreground">
                                    时间戳 ({useMilliseconds ? '毫秒' : '秒'})
                                </Label>
                                <div className="flex items-center gap-2">
                                    <div className="flex-1 px-4 py-3 rounded-lg bg-muted font-mono text-xl tabular-nums">
                                        {currentTimestampDisplay}
                                    </div>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Button
                                                variant="outline"
                                                size="icon"
                                                onClick={() => copyToClipboard(currentTimestampDisplay, 'current-ts')}
                                            >
                                                {copiedStates['current-ts'] ? (
                                                    <Check className="h-4 w-4 text-green-500" />
                                                ) : (
                                                    <Copy className="h-4 w-4" />
                                                )}
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>复制时间戳</TooltipContent>
                                    </Tooltip>
                                </div>
                            </div>

                            {/* 格式化时间 */}
                            <div className="space-y-2">
                                <Label className="text-muted-foreground">格式化时间</Label>
                                <div className="flex items-center gap-2">
                                    <div className="flex-1 px-4 py-3 rounded-lg bg-muted font-mono text-xl">
                                        {currentTimeFormatted}
                                    </div>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Button
                                                variant="outline"
                                                size="icon"
                                                onClick={() => copyToClipboard(currentTimeFormatted, 'current-time')}
                                            >
                                                {copiedStates['current-time'] ? (
                                                    <Check className="h-4 w-4 text-green-500" />
                                                ) : (
                                                    <Copy className="h-4 w-4" />
                                                )}
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>复制时间</TooltipContent>
                                    </Tooltip>
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* 转换区域 */}
                <div className="grid grid-cols-2 gap-6 flex-1">
                    {/* 时间戳 -> 时间 */}
                    <Card>
                        <CardHeader className="pb-3">
                            <CardTitle className="flex items-center gap-2 text-base">
                                <ArrowRight className="h-4 w-4" />
                                时间戳转时间
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <Label>输入时间戳</Label>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-6 px-2 text-xs"
                                        onClick={fillCurrentTimestamp}
                                    >
                                        <RefreshCw className="h-3 w-3 mr-1" />
                                        填充当前
                                    </Button>
                                </div>
                                <div className="flex gap-2">
                                    <Input
                                        value={inputTimestamp}
                                        onChange={(e) => setInputTimestamp(e.target.value)}
                                        placeholder="输入时间戳（秒或毫秒）"
                                        className="font-mono"
                                    />
                                    <Button onClick={convertTimestampToTime}>
                                        转换
                                    </Button>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    支持秒（10位）和毫秒（13位）格式
                                </p>
                            </div>

                            {timestampError && (
                                <div className="text-sm text-destructive">{timestampError}</div>
                            )}

                            {convertedTime && (
                                <div className="space-y-2">
                                    <Label className="text-muted-foreground">转换结果</Label>
                                    <div className="flex items-center gap-2">
                                        <div className="flex-1 px-3 py-2 rounded-lg bg-muted font-mono text-sm">
                                            {convertedTime}
                                        </div>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <Button
                                                    variant="outline"
                                                    size="icon"
                                                    className="h-9 w-9"
                                                    onClick={() => copyToClipboard(convertedTime, 'ts-to-time')}
                                                >
                                                    {copiedStates['ts-to-time'] ? (
                                                        <Check className="h-4 w-4 text-green-500" />
                                                    ) : (
                                                        <Copy className="h-4 w-4" />
                                                    )}
                                                </Button>
                                            </TooltipTrigger>
                                            <TooltipContent>复制</TooltipContent>
                                        </Tooltip>
                                    </div>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* 时间 -> 时间戳 */}
                    <Card>
                        <CardHeader className="pb-3">
                            <CardTitle className="flex items-center gap-2 text-base">
                                <ArrowLeft className="h-4 w-4" />
                                时间转时间戳
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <Label>输入时间</Label>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-6 px-2 text-xs"
                                        onClick={fillCurrentTime}
                                    >
                                        <RefreshCw className="h-3 w-3 mr-1" />
                                        填充当前
                                    </Button>
                                </div>
                                <div className="flex gap-2">
                                    <Input
                                        value={inputTime}
                                        onChange={(e) => setInputTime(e.target.value)}
                                        placeholder="如：2024-12-23 14:30:00"
                                        className="font-mono"
                                    />
                                    <Button onClick={convertTimeToTimestamp}>
                                        转换
                                    </Button>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    支持多种时间格式，如 YYYY-MM-DD HH:mm:ss
                                </p>
                            </div>

                            {timeError && (
                                <div className="text-sm text-destructive">{timeError}</div>
                            )}

                            {convertedTimestamp && (
                                <div className="space-y-2">
                                    <Label className="text-muted-foreground">
                                        转换结果 ({useMilliseconds ? '毫秒' : '秒'})
                                    </Label>
                                    <div className="flex items-center gap-2">
                                        <div className="flex-1 px-3 py-2 rounded-lg bg-muted font-mono text-sm">
                                            {convertedTimestamp}
                                        </div>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <Button
                                                    variant="outline"
                                                    size="icon"
                                                    className="h-9 w-9"
                                                    onClick={() => copyToClipboard(convertedTimestamp, 'time-to-ts')}
                                                >
                                                    {copiedStates['time-to-ts'] ? (
                                                        <Check className="h-4 w-4 text-green-500" />
                                                    ) : (
                                                        <Copy className="h-4 w-4" />
                                                    )}
                                                </Button>
                                            </TooltipTrigger>
                                            <TooltipContent>复制</TooltipContent>
                                        </Tooltip>
                                    </div>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>
            </div>
        </TooltipProvider>
    )
}
