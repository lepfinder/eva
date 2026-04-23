/**
 * 本地监听端口工具
 * 查看和管理本地监听的端口
 */
import { useState, useCallback, useEffect, useMemo } from 'react'
import { Search, RefreshCw, Loader2, Radio, Globe, Skull } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger
} from '@/components/ui/tooltip'

interface ListeningPort {
    protocol: 'tcp' | 'udp'
    localAddress: string
    port: number
    pid: number
    processName: string
    command?: string
}

export function LocalPorts() {
    const [listeningPorts, setListeningPorts] = useState<ListeningPort[]>([])
    const [loading, setLoading] = useState(false)
    const [searchQuery, setSearchQuery] = useState('')
    const [actionLoading, setActionLoading] = useState<string | null>(null)

    // 加载端口列表
    const fetchListeningPorts = useCallback(async () => {
        setLoading(true)
        try {
            const ports = await window.api.getListeningPorts()
            setListeningPorts(ports)
        } catch (err) {
            console.error('加载监听端口失败:', err)
        } finally {
            setLoading(false)
        }
    }, [])

    // 初始加载和自动刷新
    useEffect(() => {
        fetchListeningPorts()
        const interval = setInterval(fetchListeningPorts, 5000)
        return () => clearInterval(interval)
    }, [fetchListeningPorts])

    // 过滤端口
    const filteredPorts = useMemo(() => {
        if (!searchQuery.trim()) return listeningPorts
        const query = searchQuery.toLowerCase().trim()
        return listeningPorts.filter(
            (port) =>
                port.port.toString().includes(query) ||
                port.processName.toLowerCase().includes(query) ||
                port.pid.toString().includes(query) ||
                (port.command && port.command.toLowerCase().includes(query))
        )
    }, [listeningPorts, searchQuery])

    // 终止进程
    const handleKillProcess = async (pid: number) => {
        setActionLoading(`kill-${pid}`)
        try {
            const result = await window.api.killProcess(pid)
            if (result.success) {
                fetchListeningPorts()
            }
        } catch (err) {
            console.error('终止进程失败:', err)
        } finally {
            setActionLoading(null)
        }
    }

    // 在浏览器中打开
    const handleOpenInBrowser = async (port: number) => {
        await window.api.openInBrowser(`http://localhost:${port}`)
    }

    return (
        <div className="h-full flex flex-col space-y-4">
            {/* 搜索和刷新 */}
            <div className="flex items-center justify-between gap-4">
                <div className="relative flex-1 max-w-xs">
                    <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                        <Search className="h-4 w-4 text-muted-foreground" />
                    </span>
                    <Input
                        type="text"
                        placeholder="搜索端口号、进程名..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-9"
                    />
                </div>
                <div className="flex items-center gap-2">
                    <Badge variant="secondary">
                        共 {listeningPorts.length} 个端口
                    </Badge>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={fetchListeningPorts}
                        disabled={loading}
                    >
                        {loading ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                            <RefreshCw className="mr-2 h-4 w-4" />
                        )}
                        刷新
                    </Button>
                </div>
            </div>

            {/* 端口列表 */}
            <div className="flex-1 overflow-auto">
                {loading && listeningPorts.length === 0 ? (
                    <div className="flex h-[30vh] items-center justify-center">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    </div>
                ) : listeningPorts.length === 0 ? (
                    <Card>
                        <CardContent className="flex flex-col items-center justify-center py-16">
                            <Radio className="h-16 w-16 text-muted-foreground/30" />
                            <h3 className="mt-4 text-lg font-medium">没有发现监听中的端口</h3>
                            <p className="mt-2 text-center text-sm text-muted-foreground">
                                当前没有本地服务在监听端口
                            </p>
                        </CardContent>
                    </Card>
                ) : filteredPorts.length === 0 ? (
                    <Card>
                        <CardContent className="flex flex-col items-center justify-center py-16">
                            <Search className="h-16 w-16 text-muted-foreground/30" />
                            <h3 className="mt-4 text-lg font-medium">没有匹配的端口</h3>
                            <p className="mt-2 text-center text-sm text-muted-foreground">
                                尝试修改搜索条件
                            </p>
                        </CardContent>
                    </Card>
                ) : (
                    <div className="rounded-lg border">
                        <table className="w-full">
                            <thead className="border-b bg-muted/50">
                                <tr>
                                    <th className="px-4 py-3 text-left text-sm font-medium">端口</th>
                                    <th className="px-4 py-3 text-left text-sm font-medium">进程名</th>
                                    <th className="px-4 py-3 text-left text-sm font-medium">PID</th>
                                    <th className="px-4 py-3 text-left text-sm font-medium">命令</th>
                                    <th className="px-4 py-3 text-right text-sm font-medium">操作</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y">
                                {filteredPorts.map((port) => {
                                    const isKilling = actionLoading === `kill-${port.pid}`
                                    return (
                                        <tr
                                            key={`${port.port}-${port.pid}`}
                                            className="hover:bg-muted/30 transition-colors"
                                        >
                                            <td className="px-4 py-3">
                                                <div className="flex items-center gap-2">
                                                    <Badge variant="outline" className="font-mono">
                                                        {port.port}
                                                    </Badge>
                                                    <span className="text-xs text-muted-foreground">
                                                        {port.localAddress === '0.0.0.0' ? '全部' : port.localAddress}
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3">
                                                <TooltipProvider>
                                                    <Tooltip>
                                                        <TooltipTrigger asChild>
                                                            <span className="font-medium truncate max-w-[120px] block cursor-default">
                                                                {port.processName}
                                                            </span>
                                                        </TooltipTrigger>
                                                        <TooltipContent side="top" className="max-w-md">
                                                            <p className="font-mono text-sm">{port.processName}</p>
                                                        </TooltipContent>
                                                    </Tooltip>
                                                </TooltipProvider>
                                            </td>
                                            <td className="px-4 py-3">
                                                <code className="text-xs text-muted-foreground">{port.pid}</code>
                                            </td>
                                            <td className="px-4 py-3">
                                                <TooltipProvider>
                                                    <Tooltip>
                                                        <TooltipTrigger asChild>
                                                            <code className="text-xs text-muted-foreground truncate max-w-[300px] block cursor-default">
                                                                {port.command || '-'}
                                                            </code>
                                                        </TooltipTrigger>
                                                        <TooltipContent side="top" className="max-w-2xl">
                                                            <p className="font-mono text-xs break-all whitespace-pre-wrap">
                                                                {port.command || '-'}
                                                            </p>
                                                        </TooltipContent>
                                                    </Tooltip>
                                                </TooltipProvider>
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                <div className="flex justify-end gap-1">
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        className="h-8 w-8 p-0"
                                                        onClick={() => handleOpenInBrowser(port.port)}
                                                        title="在浏览器中打开"
                                                    >
                                                        <Globe className="h-4 w-4" />
                                                    </Button>
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        className="h-8 w-8 p-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                                                        onClick={() => handleKillProcess(port.pid)}
                                                        disabled={isKilling}
                                                        title="终止进程"
                                                    >
                                                        {isKilling ? (
                                                            <Loader2 className="h-4 w-4 animate-spin" />
                                                        ) : (
                                                            <Skull className="h-4 w-4" />
                                                        )}
                                                    </Button>
                                                </div>
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    )
}
