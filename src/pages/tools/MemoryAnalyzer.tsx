/**
 * 内存分析工具
 * 基于进程树聚合的智能内存分析，使用 Treemap 可视化
 */
import { useState, useCallback, useEffect } from 'react'
import { Treemap, ResponsiveContainer, Tooltip } from 'recharts'
import {
    RotateCcw,
    HardDrive,
    ChevronDown,
    ChevronRight,
    Cpu,
    RefreshCw,
    AlertTriangle,
    Zap,
    X,
    Info
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

// ==================== 类型定义 ====================

interface ProcessDetail {
    pid: number
    name: string
    rss: number
}

interface AppMemoryGroup {
    name: string
    total_rss: number
    formatted_rss: string
    process_count: number
    icon?: string
    processes: ProcessDetail[]
}

interface SystemMemoryInfo {
    total: number
    used: number
    available: number
    percent: number
    swap_total: number
    swap_used: number
    // macOS 特有字段
    app_memory?: number
    wired?: number
    compressed?: number
    cached?: number
    active?: number
    inactive?: number
}

interface MemoryAnalysisResult {
    system: SystemMemoryInfo
    apps: AppMemoryGroup[]
}

// Treemap 数据格式
interface TreemapData {
    name: string
    size: number
    formatted: string
    fill: string
    processCount: number
    [key: string]: string | number
}

// ==================== 柔和色彩调色板 ====================

// 使用更柔和的渐变色彩，从深到浅
const SOFT_COLORS = [
    'hsl(220, 70%, 50%)',   // 深靛蓝
    'hsl(240, 60%, 55%)',   // 紫蓝
    'hsl(260, 55%, 55%)',   // 紫色
    'hsl(280, 50%, 55%)',   // 紫红
    'hsl(200, 65%, 50%)',   // 天蓝
    'hsl(180, 55%, 45%)',   // 青色
    'hsl(160, 50%, 45%)',   // 青绿
    'hsl(300, 45%, 55%)',   // 粉紫
    'hsl(230, 55%, 60%)',   // 淡靛蓝
    'hsl(270, 50%, 60%)',   // 淡紫
]

// ==================== 工具函数 ====================

/**
 * 将字节转换为人类可读格式
 */
function formatBytes(bytes: number): string {
    if (bytes >= 1024 ** 3) {
        return `${(bytes / 1024 ** 3).toFixed(1)} GB`
    }
    if (bytes >= 1024 ** 2) {
        return `${(bytes / 1024 ** 2).toFixed(1)} MB`
    }
    if (bytes >= 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`
    }
    return `${bytes} B`
}

/**
 * 根据索引获取颜色
 */
function getColorByIndex(index: number): string {
    return SOFT_COLORS[index % SOFT_COLORS.length]
}

// ==================== Treemap 自定义内容 ====================

interface CustomContentProps {
    x: number
    y: number
    width: number
    height: number
    name: string
    formatted: string
    fill: string
    index?: number
    onAppClick?: (name: string) => void
}

const CustomContent: React.FC<CustomContentProps> = (props) => {
    const { x, y, width, height, name, formatted, fill, onAppClick } = props

    // 根据格子大小决定显示内容
    const showLabel = width > 50 && height > 35
    const showValue = width > 70 && height > 50

    const handleClick = () => {
        if (onAppClick && name) {
            onAppClick(name)
        }
    }

    return (
        <g onClick={handleClick} style={{ cursor: 'pointer' }}>
            <rect
                x={x}
                y={y}
                width={width}
                height={height}
                rx={6}
                fill={fill}
                stroke="rgba(255,255,255,0.15)"
                strokeWidth={2}
                style={{
                    filter: 'brightness(1)',
                    transition: 'all 0.2s ease'
                }}
                onMouseEnter={(e) => {
                    e.currentTarget.style.filter = 'brightness(1.15)'
                    e.currentTarget.style.strokeWidth = '3'
                }}
                onMouseLeave={(e) => {
                    e.currentTarget.style.filter = 'brightness(1)'
                    e.currentTarget.style.strokeWidth = '2'
                }}
            />
            {showLabel && (
                <text
                    x={x + width / 2}
                    y={y + height / 2 - (showValue ? 10 : 0)}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill="rgba(255,255,255,0.95)"
                    fontSize={width > 120 ? 13 : 11}
                    fontWeight="600"
                    style={{ pointerEvents: 'none', textShadow: '0 1px 2px rgba(0,0,0,0.3)' }}
                >
                    {name.length > (width > 100 ? 14 : 10) ? name.slice(0, width > 100 ? 14 : 10) + '...' : name}
                </text>
            )}
            {showValue && (
                <text
                    x={x + width / 2}
                    y={y + height / 2 + 12}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill="rgba(255,255,255,0.75)"
                    fontSize={11}
                    fontWeight="500"
                    style={{ pointerEvents: 'none' }}
                >
                    {formatted}
                </text>
            )}
        </g>
    )
}

// ==================== 自定义 Tooltip ====================

interface CustomTooltipProps {
    active?: boolean
    payload?: Array<{
        payload: TreemapData
    }>
}

const CustomTooltip: React.FC<CustomTooltipProps> = ({ active, payload }) => {
    if (!active || !payload || !payload.length) return null

    const data = payload[0].payload

    return (
        <div className="rounded-xl border bg-popover/95 backdrop-blur-sm p-4 shadow-xl">
            <p className="font-semibold text-foreground text-base">{data.name}</p>
            <div className="mt-2 space-y-1">
                <p className="text-sm text-primary font-medium">{data.formatted}</p>
                <p className="text-xs text-muted-foreground">{data.processCount} 个进程</p>
            </div>
            <p className="text-xs text-muted-foreground mt-2 pt-2 border-t">点击查看详情</p>
        </div>
    )
}

// ==================== 应用详情面板 ====================

interface AppDetailPanelProps {
    app: AppMemoryGroup | null
    onClose: () => void
}

function AppDetailPanel({ app, onClose }: AppDetailPanelProps): React.ReactElement | null {
    if (!app) return null

    const isHighMemory = app.total_rss > 2 * 1024 ** 3
    const isMediumMemory = app.total_rss > 1 * 1024 ** 3

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
            <Card
                className="w-full max-w-2xl max-h-[80vh] overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-200"
                onClick={(e) => e.stopPropagation()}
            >
                <CardHeader className="border-b bg-gradient-to-r from-primary/10 to-transparent">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${isHighMemory ? 'bg-red-500/20 text-red-500' :
                                isMediumMemory ? 'bg-orange-500/20 text-orange-500' :
                                    'bg-primary/20 text-primary'
                                }`}>
                                <HardDrive className="h-5 w-5" />
                            </div>
                            <div>
                                <CardTitle className="text-lg">{app.name}</CardTitle>
                                <p className="text-sm text-muted-foreground mt-0.5">
                                    {app.process_count} 个进程
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            <span className={`text-2xl font-bold ${isHighMemory ? 'text-red-500' :
                                isMediumMemory ? 'text-orange-500' :
                                    'text-primary'
                                }`}>
                                {app.formatted_rss}
                            </span>
                            <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
                                <X className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="p-0 max-h-[60vh] overflow-auto">
                    <table className="w-full">
                        <thead className="bg-muted/50 sticky top-0">
                            <tr className="text-xs text-muted-foreground">
                                <th className="text-left py-3 px-4 font-medium w-20">PID</th>
                                <th className="text-left py-3 px-4 font-medium">进程名</th>
                                <th className="text-right py-3 px-4 font-medium w-28">内存占用</th>
                                <th className="text-right py-3 px-4 font-medium w-20">占比</th>
                            </tr>
                        </thead>
                        <tbody>
                            {app.processes.map((proc, index) => {
                                const percentage = ((proc.rss / app.total_rss) * 100).toFixed(1)
                                return (
                                    <tr
                                        key={proc.pid}
                                        className={`border-b last:border-b-0 hover:bg-muted/30 transition-colors ${index % 2 === 0 ? 'bg-transparent' : 'bg-muted/10'
                                            }`}
                                    >
                                        <td className="py-3 px-4 font-mono text-sm text-muted-foreground">
                                            {proc.pid}
                                        </td>
                                        <td className="py-3 px-4">
                                            <p className="truncate max-w-[300px] text-sm font-medium">
                                                {proc.name}
                                            </p>
                                        </td>
                                        <td className="py-3 px-4 text-right">
                                            <span className="font-medium text-sm">
                                                {formatBytes(proc.rss)}
                                            </span>
                                        </td>
                                        <td className="py-3 px-4 text-right">
                                            <div className="flex items-center justify-end gap-2">
                                                <div className="w-12 h-1.5 bg-muted rounded-full overflow-hidden">
                                                    <div
                                                        className="h-full bg-primary rounded-full"
                                                        style={{ width: `${Math.min(parseFloat(percentage), 100)}%` }}
                                                    />
                                                </div>
                                                <span className="text-xs text-muted-foreground w-10">
                                                    {percentage}%
                                                </span>
                                            </div>
                                        </td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </CardContent>
            </Card>
        </div>
    )
}

// ==================== 进程列表项组件 ====================

interface AppItemProps {
    app: AppMemoryGroup
    isExpanded: boolean
    onToggle: () => void
    index: number
    colorIndex: number
}

function AppItem({ app, isExpanded, onToggle, index, colorIndex }: AppItemProps): React.ReactElement {
    const isHighMemory = app.total_rss > 2 * 1024 ** 3
    const isMediumMemory = app.total_rss > 1 * 1024 ** 3

    return (
        <div className="border-b last:border-b-0">
            <button
                className={`w-full flex items-center gap-3 p-3 hover:bg-muted/50 transition-colors ${isExpanded ? 'bg-muted/30' : ''
                    }`}
                onClick={onToggle}
            >
                {/* 色块指示器 */}
                <div
                    className="w-3 h-8 rounded-sm shrink-0"
                    style={{ backgroundColor: getColorByIndex(colorIndex) }}
                />

                {/* 排名 */}
                <span className="w-6 text-center text-sm text-muted-foreground font-medium">
                    {index + 1}
                </span>

                {/* 展开图标 */}
                <span className="text-muted-foreground">
                    {isExpanded ? (
                        <ChevronDown className="h-4 w-4" />
                    ) : (
                        <ChevronRight className="h-4 w-4" />
                    )}
                </span>

                {/* 应用名 */}
                <span className="flex-1 text-left font-medium truncate">
                    {app.name}
                </span>

                {/* 内存警告图标 */}
                {isHighMemory && (
                    <AlertTriangle className="h-4 w-4 text-red-500" />
                )}
                {isMediumMemory && !isHighMemory && (
                    <Zap className="h-4 w-4 text-orange-500" />
                )}

                {/* 进程数 */}
                <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
                    {app.process_count} 进程
                </span>

                {/* 内存占用 */}
                <span
                    className={`font-bold min-w-[80px] text-right ${isHighMemory
                        ? 'text-red-500'
                        : isMediumMemory
                            ? 'text-orange-500'
                            : 'text-primary'
                        }`}
                >
                    {app.formatted_rss}
                </span>
            </button>

            {/* 子进程列表 */}
            {isExpanded && (
                <div className="bg-muted/20 border-t">
                    <div className="p-2">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-muted-foreground text-xs">
                                    <th className="text-left py-1 px-2 font-medium">PID</th>
                                    <th className="text-left py-1 px-2 font-medium">进程名</th>
                                    <th className="text-right py-1 px-2 font-medium">内存</th>
                                </tr>
                            </thead>
                            <tbody>
                                {app.processes.map((proc) => (
                                    <tr
                                        key={proc.pid}
                                        className="hover:bg-muted/50 transition-colors"
                                    >
                                        <td className="py-1 px-2 font-mono text-muted-foreground">
                                            {proc.pid}
                                        </td>
                                        <td className="py-1 px-2 truncate max-w-[300px]">
                                            {proc.name}
                                        </td>
                                        <td className="py-1 px-2 text-right font-medium">
                                            {formatBytes(proc.rss)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    )
}

// ==================== 主组件 ====================

export function MemoryAnalyzer(): React.ReactElement {
    const [data, setData] = useState<MemoryAnalysisResult | null>(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [expandedApps, setExpandedApps] = useState<Set<string>>(new Set())
    const [selectedApp, setSelectedApp] = useState<AppMemoryGroup | null>(null)

    // 扫描内存
    const scanMemory = useCallback(async () => {
        setLoading(true)
        setError(null)

        try {
            const result: MemoryAnalysisResult = await (window as any).api.getMemoryAnalysis()
            setData(result)
        } catch (err) {
            console.error('Memory scan failed:', err)
            setError(err instanceof Error ? err.message : '扫描失败')
        } finally {
            setLoading(false)
        }
    }, [])

    // 组件加载时自动扫描
    useEffect(() => {
        scanMemory()
    }, [scanMemory])

    // 切换展开状态
    const toggleExpanded = useCallback((appName: string) => {
        setExpandedApps((prev) => {
            const next = new Set(prev)
            if (next.has(appName)) {
                next.delete(appName)
            } else {
                next.add(appName)
            }
            return next
        })
    }, [])

    // 处理 Treemap 点击
    const handleTreemapClick = useCallback((appName: string) => {
        if (data) {
            const app = data.apps.find(a => a.name === appName)
            if (app) {
                setSelectedApp(app)
            }
        }
    }, [data])

    // 准备 Treemap 数据
    const treemapData: TreemapData[] = data
        ? data.apps.slice(0, 10).map((app, index) => ({
            name: app.name,
            size: app.total_rss,
            formatted: app.formatted_rss,
            fill: getColorByIndex(index),
            processCount: app.process_count
        }))
        : []

    // 自定义内容组件，注入点击处理
    const TreemapContent = useCallback((props: CustomContentProps) => (
        <CustomContent {...props} onAppClick={handleTreemapClick} />
    ), [handleTreemapClick])

    return (
        <div className="h-full flex flex-col gap-4">
            {/* 标题栏 */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-lg font-bold flex items-center gap-2">
                        <HardDrive className="h-5 w-5 text-primary" />
                        内存透视镜
                    </h2>
                    <p className="text-sm text-muted-foreground">
                        基于进程树聚合的智能内存分析
                    </p>
                </div>
                <Button
                    onClick={scanMemory}
                    disabled={loading}
                    className="gap-2"
                >
                    {loading ? (
                        <>
                            <RefreshCw className="h-4 w-4 animate-spin" />
                            扫描中...
                        </>
                    ) : data ? (
                        <>
                            <RotateCcw className="h-4 w-4" />
                            重新扫描
                        </>
                    ) : (
                        <>
                            <Cpu className="h-4 w-4" />
                            开始扫描
                        </>
                    )}
                </Button>
            </div>

            {/* 错误提示 */}
            {error && (
                <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4 flex items-center gap-3">
                    <AlertTriangle className="h-5 w-5 text-destructive shrink-0" />
                    <div>
                        <p className="font-medium text-destructive">扫描失败</p>
                        <p className="text-sm text-muted-foreground">{error}</p>
                    </div>
                </div>
            )}

            {/* 空状态 */}
            {!data && !loading && !error && (
                <div className="flex-1 flex items-center justify-center">
                    <div className="text-center space-y-4">
                        <div className="h-20 w-20 mx-auto rounded-full bg-primary/10 flex items-center justify-center">
                            <HardDrive className="h-10 w-10 text-primary" />
                        </div>
                        <div>
                            <h3 className="font-medium text-lg">准备就绪</h3>
                            <p className="text-muted-foreground text-sm mt-1">
                                点击上方"开始扫描"按钮分析当前内存占用
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {/* 加载状态 */}
            {loading && !data && (
                <div className="flex-1 flex items-center justify-center">
                    <div className="text-center space-y-4">
                        <RefreshCw className="h-12 w-12 mx-auto text-primary animate-spin" />
                        <p className="text-muted-foreground">正在扫描进程...</p>
                    </div>
                </div>
            )}

            {/* 数据展示区域 */}
            {data && (
                <div className="flex-1 min-h-0 flex flex-col gap-4 overflow-auto">
                    {/* 系统总览卡片 - 活动监视器风格 */}
                    <Card className="mb-4">
                        <CardContent className="pt-6">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                                {/* 已使用内存 - 主要指标 */}
                                <div className="col-span-2 md:col-span-1">
                                    <p className="text-sm text-muted-foreground mb-1">已使用内存</p>
                                    <div className="flex items-baseline gap-2">
                                        <span className="text-3xl font-bold text-primary">
                                            {formatBytes(data.system.used)}
                                        </span>
                                    </div>
                                    <div className="mt-3 h-2.5 bg-muted rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 transition-all"
                                            style={{ width: `${data.system.percent}%` }}
                                        />
                                    </div>
                                    <p className="text-xs text-muted-foreground mt-1.5">
                                        {data.system.percent.toFixed(1)}% of {formatBytes(data.system.total)}
                                    </p>
                                </div>

                                {/* 详细分类 */}
                                <div className="space-y-3">
                                    <div>
                                        <p className="text-xs text-muted-foreground">App 内存</p>
                                        <p className="text-lg font-semibold text-blue-500">
                                            {formatBytes(data.system.app_memory || 0)}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-muted-foreground">联动内存</p>
                                        <p className="text-lg font-semibold text-purple-500">
                                            {formatBytes(data.system.wired || 0)}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-muted-foreground">被压缩</p>
                                        <p className="text-lg font-semibold text-pink-500">
                                            {formatBytes(data.system.compressed || 0)}
                                        </p>
                                    </div>
                                </div>

                                <div className="space-y-3">
                                    <div>
                                        <p className="text-xs text-muted-foreground">已缓存文件</p>
                                        <p className="text-lg font-semibold text-cyan-500">
                                            {formatBytes(data.system.cached || 0)}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-muted-foreground">可用内存</p>
                                        <p className="text-lg font-semibold text-green-500">
                                            {formatBytes(data.system.available)}
                                        </p>
                                    </div>
                                </div>

                                {/* 交换内存 */}
                                <div className="space-y-3">
                                    <div>
                                        <p className="text-xs text-muted-foreground">交换内存 (Swap)</p>
                                        <p className={`text-lg font-semibold ${data.system.swap_used > 0 ? 'text-orange-500' : 'text-muted-foreground'}`}>
                                            {formatBytes(data.system.swap_used)}
                                        </p>
                                        <p className="text-[10px] text-muted-foreground">
                                            / {formatBytes(data.system.swap_total)}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-muted-foreground">物理内存总量</p>
                                        <p className="text-lg font-semibold">
                                            {formatBytes(data.system.total)}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Treemap 可视化 */}
                    <Card className="flex-shrink-0">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-base flex items-center gap-2">
                                📊 内存占用可视化
                                <span className="text-xs font-normal text-muted-foreground">
                                    (Top 10 应用，点击查看详情)
                                </span>
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="h-[300px] w-full rounded-lg overflow-hidden bg-background/50">
                                <ResponsiveContainer width="100%" height="100%">
                                    <Treemap
                                        data={treemapData}
                                        dataKey="size"
                                        aspectRatio={4 / 3}
                                        stroke="rgba(0,0,0,0.3)"
                                        content={<TreemapContent x={0} y={0} width={0} height={0} name="" formatted="" fill="" />}
                                    >
                                        <Tooltip content={<CustomTooltip />} />
                                    </Treemap>
                                </ResponsiveContainer>
                            </div>
                            {/* 图例 */}
                            <div className="mt-3 flex items-center justify-center gap-2">
                                <Info className="h-3.5 w-3.5 text-muted-foreground" />
                                <span className="text-xs text-muted-foreground">
                                    面积越大表示内存占用越高
                                </span>
                            </div>
                        </CardContent>
                    </Card>

                    {/* 应用列表 */}
                    <Card className="flex-1 min-h-0">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-base flex items-center gap-2">
                                📋 详细列表
                                <span className="text-xs font-normal text-muted-foreground">
                                    (Top 20 应用，点击展开查看进程详情)
                                </span>
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="p-0">
                            <div>
                                {data.apps.map((app, index) => (
                                    <AppItem
                                        key={app.name}
                                        app={app}
                                        index={index}
                                        colorIndex={index}
                                        isExpanded={expandedApps.has(app.name)}
                                        onToggle={() => toggleExpanded(app.name)}
                                    />
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                </div>
            )}

            {/* 应用详情弹窗 */}
            <AppDetailPanel
                app={selectedApp}
                onClose={() => setSelectedApp(null)}
            />
        </div>
    )
}
