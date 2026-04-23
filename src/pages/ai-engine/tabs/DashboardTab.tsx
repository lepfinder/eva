import React from 'react'
import {
    Cpu, Wifi, HardDrive, Zap, Clock, Terminal, RefreshCcw, Trash2, Settings2, Maximize2, Minimize2
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { TabsContent } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import type { PythonServiceInfo } from '@/hooks/usePythonService'
import type { LogEntry, ResourceMetrics, AIProvider, SystemModelConfig } from '../types'

interface DashboardTabProps {
    serviceInfo: PythonServiceInfo | null
    isConnected: boolean
    isLoading: boolean
    metrics: ResourceMetrics
    apiLatency: number | null
    logs: LogEntry[]
    logLevel: 'debug' | 'info' | 'error'
    isConsoleExpanded: boolean
    systemModelConfig: SystemModelConfig
    providers: AIProvider[]
    logsContainerRef: React.RefObject<HTMLDivElement>
    onClearLogs: () => void
    onSetLogLevel: (level: 'debug' | 'info' | 'error') => void
    onToggleConsole: () => void
    onSetShowSystemModelSettings: (v: boolean) => void
    onRestart: () => void
    formatUptime: (ms: number | null) => string
    getStatusColor: () => string
    getStatusDotColor: () => string
    getStatusText: () => string
}

export function DashboardTab({
    serviceInfo,
    isConnected,
    isLoading,
    metrics,
    apiLatency,
    logs,
    logLevel,
    isConsoleExpanded,
    systemModelConfig,
    providers,
    logsContainerRef,
    onClearLogs,
    onSetLogLevel,
    onToggleConsole,
    onSetShowSystemModelSettings,
    onRestart,
    formatUptime,
    getStatusColor,
    getStatusDotColor,
    getStatusText
}: DashboardTabProps) {
    return (
        <TabsContent value="dashboard" className="flex-1 overflow-auto mt-0 scrollbar-thin">
            <div className="px-6 pb-6 grid grid-cols-12 gap-5 animation-fade-in">
                {/* 左侧 */}
                <div className={cn("col-span-7 space-y-5 transition-all duration-300", isConsoleExpanded && "hidden")}>
                    {/* 状态指标 */}
                    <div className="space-y-3">
                        <Card className="bg-white border-zinc-200 shadow-sm">
                            <CardContent className="p-4 flex items-center justify-between">
                                <div className="flex items-center gap-4">
                                    <div className="relative h-12 w-12 rounded-xl bg-zinc-50 flex items-center justify-center shrink-0">
                                        <div className={cn("h-3 w-3 rounded-full relative", getStatusDotColor())} />
                                    </div>
                                    <div>
                                        <div className="text-sm font-medium text-zinc-500 uppercase tracking-wider mb-0.5">运行状态</div>
                                        <div className="flex items-center gap-2">
                                            <div className={cn("text-lg font-semibold", getStatusColor())}>{getStatusText()}</div>
                                            {serviceInfo?.pid && (
                                                <span className="text-xs font-mono text-zinc-400 bg-zinc-100 px-1.5 py-0.5 rounded">PID {serviceInfo.pid}</span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <div className="grid grid-cols-3 gap-3">
                            {/* CPU */}
                            <Card className="bg-white border-zinc-200 shadow-sm">
                                <CardContent className="p-4">
                                    <div className="flex items-center justify-between mb-3">
                                        <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">CPU</span>
                                        <Cpu className="h-3.5 w-3.5 text-zinc-400" />
                                    </div>
                                    <div className="text-lg font-semibold text-zinc-900">{metrics.cpu.toFixed(1)}%</div>
                                    <div className="mt-2 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                                        <div className="h-full bg-violet-500 transition-all duration-700 ease-out rounded-full" style={{ width: `${Math.min(metrics.cpu, 100)}%` }} />
                                    </div>
                                </CardContent>
                            </Card>
                            {/* 内存 */}
                            <Card className="bg-white border-zinc-200 shadow-sm">
                                <CardContent className="p-4">
                                    <div className="flex items-center justify-between mb-3">
                                        <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">内存</span>
                                        <HardDrive className="h-3.5 w-3.5 text-zinc-400" />
                                    </div>
                                    <div className="text-lg font-semibold text-zinc-900">{metrics.memory.toFixed(0)} MB</div>
                                    <div className="mt-2 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                                        <div className="h-full bg-indigo-500 transition-all duration-700 ease-out rounded-full" style={{ width: `${Math.min(metrics.memory / 8, 100)}%` }} />
                                    </div>
                                </CardContent>
                            </Card>
                            {/* GPU */}
                            <Card className="bg-white border-zinc-200 shadow-sm">
                                <CardContent className="p-4">
                                    <div className="flex items-center justify-between mb-3">
                                        <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">GPU</span>
                                        <Zap className="h-3.5 w-3.5 text-zinc-400" />
                                    </div>
                                    <div className="text-lg font-semibold text-zinc-900">
                                        {metrics.gpu !== null ? `${metrics.gpu.toFixed(1)}%` : 'N/A'}
                                    </div>
                                    <div className="mt-2 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                                        <div className="h-full bg-violet-600 transition-all duration-700 ease-out rounded-full" style={{ width: `${Math.min(metrics.gpu ?? 0, 100)}%` }} />
                                    </div>
                                </CardContent>
                            </Card>
                        </div>
                    </div>

                    {/* 连接信息 */}
                    <Card className="bg-white border-zinc-200 shadow-sm">
                        <CardContent className="p-4">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-6">
                                    <div className="flex items-center gap-2">
                                        <Wifi className={cn("h-4 w-4", isConnected ? "text-emerald-600" : "text-zinc-400")} />
                                        <span className="text-sm font-mono text-zinc-700">127.0.0.1:{serviceInfo?.port || 18888}</span>
                                    </div>
                                    <Separator orientation="vertical" className="h-4 bg-zinc-200" />
                                    <div className="flex items-center gap-2">
                                        <Clock className="h-3.5 w-3.5 text-zinc-400" />
                                        <span className="text-sm text-zinc-500">运行时间: <span className="text-zinc-700">{formatUptime(serviceInfo?.uptime || null)}</span></span>
                                    </div>
                                    <Separator orientation="vertical" className="h-4 bg-zinc-200" />
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm text-zinc-500">
                                            延迟: <span className={cn("font-mono", apiLatency && apiLatency < 30 ? "text-emerald-600" : apiLatency && apiLatency < 100 ? "text-amber-600" : "text-zinc-400")}>{apiLatency ? `${apiLatency}ms` : '—'}</span>
                                        </span>
                                    </div>
                                </div>
                                <div className={cn("px-2.5 py-1 rounded-full text-xs font-medium", isConnected ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-zinc-100 text-zinc-500 border border-zinc-200")}>
                                    {isConnected ? '已连接' : '未连接'}
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* 当前生效模型 */}
                    <Card className="bg-white border-zinc-200 shadow-sm">
                        <CardHeader className="pb-3 border-b border-zinc-50">
                            <div className="flex items-center justify-between">
                                <CardTitle className="text-sm font-medium text-zinc-900 flex items-center gap-2">
                                    <Settings2 className="h-4 w-4 text-violet-600" />
                                    当前生效模型
                                </CardTitle>
                                <Button
                                    variant="ghost" size="sm"
                                    className="h-6 text-xs text-violet-600 hover:text-violet-700 hover:bg-violet-50 px-2"
                                    onClick={() => onSetShowSystemModelSettings(true)}
                                >
                                    配置
                                </Button>
                            </div>
                        </CardHeader>
                        <CardContent className="p-0">
                            <div className="grid grid-cols-2 divide-x divide-zinc-100">
                                {([
                                    { key: 'llm', label: 'LLM', sub: '主对话模型', color: 'bg-emerald-100 text-emerald-700' },
                                    { key: 'embedding', label: 'Embedding', sub: '向量化', color: 'bg-violet-100 text-violet-700' },
                                    { key: 'rerank', label: 'Rerank', sub: '结果重排', color: 'bg-indigo-100 text-indigo-700' },
                                    { key: 'translation', label: 'Translation', sub: '翻译服务', color: 'bg-blue-100 text-blue-700' },
                                    { key: 'stt', label: 'STT', sub: '语音转文本', color: 'bg-amber-100 text-amber-700' },
                                    { key: 'tts', label: 'TTS', sub: '文本转语音', color: 'bg-pink-100 text-pink-700' }
                                ] as const).map((item, idx) => {
                                    const config = systemModelConfig[item.key]
                                    return (
                                        <div key={item.key} className={cn("p-3 bg-zinc-50/30", idx >= 2 && "border-t border-zinc-100")}>
                                            <div className="flex items-center gap-2 mb-1.5">
                                                <span className={cn("px-1.5 py-0.5 text-[10px] font-medium rounded uppercase", item.color)}>{item.label}</span>
                                                <span className="text-xs text-zinc-400">{item.sub}</span>
                                            </div>
                                            <div className="min-w-0">
                                                <div className="text-sm font-medium text-zinc-900 truncate">{config?.model || '未配置'}</div>
                                                <div className="text-xs text-zinc-500 truncate mt-0.5">
                                                    {config?.provider ? (providers.find(p => p.id === config.provider)?.name || config.provider) : '-'}
                                                </div>
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* 右侧 - 控制台 */}
                <div className={cn("transition-all duration-300", isConsoleExpanded ? "col-span-12" : "col-span-5")}>
                    <Card className="bg-white border-zinc-200 shadow-sm h-full flex flex-col">
                        <CardHeader className="pb-3 shrink-0 border-b border-zinc-100">
                            <div className="flex items-center justify-between">
                                <CardTitle className="text-sm font-medium text-zinc-900 flex items-center gap-2">
                                    <Terminal className="h-4 w-4 text-emerald-600" />
                                    实时控制台
                                </CardTitle>
                                <div className="flex items-center gap-3">
                                    <Button
                                        variant="ghost" size="icon"
                                        className="h-6 w-6 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100"
                                        onClick={onToggleConsole}
                                        title={isConsoleExpanded ? "退出全屏" : "全屏显示"}
                                    >
                                        {isConsoleExpanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
                                    </Button>
                                    <div className="flex items-center gap-1.5">
                                        <div className="h-3 w-3 rounded-full bg-red-500" />
                                        <div className="h-3 w-3 rounded-full bg-amber-500" />
                                        <div className="h-3 w-3 rounded-full bg-emerald-500" />
                                    </div>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="flex-1 flex flex-col min-h-0 p-3">
                            <div ref={logsContainerRef} className="flex-1 overflow-auto rounded-lg bg-zinc-950 p-4 font-mono text-[11px] leading-5 min-h-[480px] max-h-[480px]">
                                {logs.length === 0 ? (
                                    <p className="text-zinc-600">等待输出...</p>
                                ) : (
                                    logs.map((log) => (
                                        <div key={log.id} className="flex gap-3">
                                            <span className="text-zinc-600 shrink-0 select-none">{log.timestamp.toLocaleTimeString('zh-CN', { hour12: false })}</span>
                                            <span className={cn(
                                                log.level === 'error' && 'text-red-400',
                                                log.level === 'warn' && 'text-amber-400',
                                                log.level === 'info' && 'text-emerald-400',
                                                log.level === 'debug' && 'text-violet-400'
                                            )}>{log.message}</span>
                                        </div>
                                    ))
                                )}
                            </div>
                            <div className="flex items-center justify-between mt-3 pt-3 border-t border-zinc-100">
                                <div className="flex items-center gap-3">
                                    <Button variant="ghost" size="sm" className="h-7 text-xs text-zinc-500 hover:text-zinc-700 hover:bg-zinc-100 px-2" onClick={onClearLogs}>
                                        <Trash2 className="h-3.5 w-3.5 mr-1" />清空
                                    </Button>
                                    <Separator orientation="vertical" className="h-4 bg-zinc-200" />
                                    <div className="flex gap-0.5 bg-zinc-100 p-0.5 rounded-md border border-zinc-200">
                                        {(['debug', 'info', 'error'] as const).map((level) => (
                                            <button
                                                key={level}
                                                className={cn(
                                                    "px-2 py-0.5 text-[10px] font-medium rounded transition-all capitalize",
                                                    logLevel === level ? "bg-white text-violet-700 shadow-sm border border-zinc-100" : "text-zinc-500 hover:text-zinc-700"
                                                )}
                                                onClick={() => onSetLogLevel(level)}
                                            >
                                                {level === 'debug' ? '调试' : level === 'info' ? '信息' : '错误'}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5 border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100 hover:border-violet-300 shadow-sm" disabled={isLoading} onClick={onRestart}>
                                    <RefreshCcw className={cn("h-3 w-3", isLoading && "animate-spin")} />
                                    强制重载
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </TabsContent>
    )
}
