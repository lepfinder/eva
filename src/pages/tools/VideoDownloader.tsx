/**
 * 视频下载工具
 * 支持 YouTube、B站等视频下载
 */
import { useState, useCallback, useEffect } from 'react'
import {
    Download,
    Search,
    Clock,
    User,
    Eye,
    CheckCircle,
    XCircle,
    Loader2,
    Folder,
    Trash2,
    RefreshCw
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/components/ui/select'
import { Progress } from '@/components/ui/progress'

const PYTHON_SERVICE_URL = 'http://127.0.0.1:18888'

// 质量选项
const QUALITY_OPTIONS = [
    { value: 'best', label: '最佳画质' },
    { value: '1080p', label: '1080p' },
    { value: '720p', label: '720p' },
    { value: '480p', label: '480p' },
    { value: 'audio', label: '仅音频' }
]

interface VideoInfo {
    title: string
    thumbnail: string | null
    duration: number | null
    duration_string: string | null
    uploader: string | null
    view_count: number | null
    formats: Array<{
        format_id: string
        display: string
        ext: string
        height: number | null
        filesize: number | null
    }>
    url: string
}

interface DownloadTask {
    task_id: string
    status: string
    progress: number
    filename: string | null
    filepath: string | null
    speed: string | null
    eta: string | null
    error: string | null
    title: string | null
    created_at: string
}

export function VideoDownloader(): React.ReactElement {
    const [url, setUrl] = useState('')
    const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null)
    const [isLoading, setIsLoading] = useState(false)
    const [isDownloading, setIsDownloading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [quality, setQuality] = useState('best')
    const [downloadTasks, setDownloadTasks] = useState<DownloadTask[]>([])
    const [currentTaskId, setCurrentTaskId] = useState<string | null>(null)

    // 获取视频信息
    const handleGetInfo = useCallback(async () => {
        if (!url.trim()) return

        setIsLoading(true)
        setError(null)
        setVideoInfo(null)

        try {
            const response = await fetch(`${PYTHON_SERVICE_URL}/video/info`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: url.trim() })
            })

            if (!response.ok) {
                const errData = await response.json()
                throw new Error(errData.detail || '获取视频信息失败')
            }

            const data = await response.json()
            setVideoInfo(data)
        } catch (err) {
            setError(err instanceof Error ? err.message : '获取视频信息失败')
        } finally {
            setIsLoading(false)
        }
    }, [url])

    // 开始下载
    const handleDownload = useCallback(async () => {
        if (!videoInfo) return

        setIsDownloading(true)
        setError(null)

        try {
            const response = await fetch(`${PYTHON_SERVICE_URL}/video/download`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    url: videoInfo.url,
                    quality
                })
            })

            if (!response.ok) {
                throw new Error('启动下载失败')
            }

            const data = await response.json()
            setCurrentTaskId(data.task_id)
        } catch (err) {
            setError(err instanceof Error ? err.message : '下载失败')
            setIsDownloading(false)
        }
    }, [videoInfo, quality])

    // 轮询下载状态
    useEffect(() => {
        if (!currentTaskId) return

        const interval = setInterval(async () => {
            try {
                const response = await fetch(
                    `${PYTHON_SERVICE_URL}/video/download/status/${currentTaskId}`
                )
                if (response.ok) {
                    const task = await response.json()

                    if (task.status === 'completed' || task.status === 'failed') {
                        setIsDownloading(false)
                        setCurrentTaskId(null)
                        loadDownloadTasks()
                    }

                    // 更新任务列表中的当前任务
                    setDownloadTasks((prev) => {
                        const exists = prev.find((t) => t.task_id === task.task_id)
                        if (exists) {
                            return prev.map((t) => (t.task_id === task.task_id ? task : t))
                        }
                        return [task, ...prev]
                    })
                }
            } catch {
                // 忽略轮询错误
            }
        }, 1000)

        return () => clearInterval(interval)
    }, [currentTaskId])

    // 加载下载任务列表
    const loadDownloadTasks = useCallback(async () => {
        try {
            const response = await fetch(`${PYTHON_SERVICE_URL}/video/download/list`)
            if (response.ok) {
                const data = await response.json()
                setDownloadTasks(data.tasks || [])
            }
        } catch {
            // 忽略错误
        }
    }, [])

    // 初始加载
    useEffect(() => {
        loadDownloadTasks()
    }, [loadDownloadTasks])

    // 删除任务
    const handleDeleteTask = useCallback(async (taskId: string) => {
        try {
            await fetch(`${PYTHON_SERVICE_URL}/video/download/${taskId}`, {
                method: 'DELETE'
            })
            setDownloadTasks((prev) => prev.filter((t) => t.task_id !== taskId))
        } catch {
            // 忽略错误
        }
    }, [])

    // 打开文件所在文件夹 (TODO: 添加 IPC API)
    const handleOpenFolder = useCallback((filepath: string) => {
        // 暂时只打印路径
        console.log('Open folder:', filepath)
    }, [])

    // 格式化播放次数
    const formatViewCount = (count: number | null): string => {
        if (!count) return '-'
        if (count >= 100000000) return `${(count / 100000000).toFixed(1)}亿`
        if (count >= 10000) return `${(count / 10000).toFixed(1)}万`
        return count.toString()
    }

    // 格式化文件大小
    const formatFileSize = (bytes: number | null): string => {
        if (!bytes) return ''
        if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)}GB`
        if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`
        return `${(bytes / 1024).toFixed(1)}KB`
    }

    return (
        <div className="flex flex-col gap-6">
            {/* URL 输入区域 */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base font-medium flex items-center gap-2">
                        <Download className="h-4 w-4" />
                        视频下载
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex gap-2">
                        <Input
                            placeholder="输入 YouTube 或 B站视频链接..."
                            value={url}
                            onChange={(e) => setUrl(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleGetInfo()}
                            className="flex-1"
                        />
                        <Button onClick={handleGetInfo} disabled={isLoading || !url.trim()}>
                            {isLoading ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                <Search className="h-4 w-4" />
                            )}
                            <span className="ml-2">解析</span>
                        </Button>
                    </div>

                    {error && (
                        <div className="p-3 bg-destructive/10 text-destructive rounded-lg text-sm">
                            {error}
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* 视频信息预览 */}
            {videoInfo && (
                <Card>
                    <CardContent className="pt-6">
                        <div className="flex gap-4">
                            {/* 封面 */}
                            <div className="flex-shrink-0 w-48 h-28 bg-muted rounded-lg overflow-hidden">
                                {videoInfo.thumbnail ? (
                                    <img
                                        src={`${PYTHON_SERVICE_URL}/video/proxy/image?url=${encodeURIComponent(videoInfo.thumbnail)}`}
                                        alt={videoInfo.title}
                                        className="w-full h-full object-cover"
                                        onError={(e) => {
                                            // 图片加载失败时隐藏
                                            (e.target as HTMLImageElement).style.display = 'none'
                                        }}
                                    />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                                        <Download className="h-8 w-8" />
                                    </div>
                                )}
                            </div>

                            {/* 信息 */}
                            <div className="flex-1 min-w-0">
                                <h3 className="font-medium text-lg truncate">{videoInfo.title}</h3>

                                <div className="flex flex-wrap gap-3 mt-2 text-sm text-muted-foreground">
                                    {videoInfo.uploader && (
                                        <div className="flex items-center gap-1">
                                            <User className="h-3.5 w-3.5" />
                                            {videoInfo.uploader}
                                        </div>
                                    )}
                                    {videoInfo.duration_string && (
                                        <div className="flex items-center gap-1">
                                            <Clock className="h-3.5 w-3.5" />
                                            {videoInfo.duration_string}
                                        </div>
                                    )}
                                    {videoInfo.view_count && (
                                        <div className="flex items-center gap-1">
                                            <Eye className="h-3.5 w-3.5" />
                                            {formatViewCount(videoInfo.view_count)} 次播放
                                        </div>
                                    )}
                                </div>

                                {/* 下载选项 */}
                                <div className="flex items-center gap-4 mt-4">
                                    <div className="flex items-center gap-2">
                                        <Label className="text-sm">画质</Label>
                                        <Select value={quality} onValueChange={setQuality}>
                                            <SelectTrigger className="w-32">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {QUALITY_OPTIONS.map((opt) => (
                                                    <SelectItem key={opt.value} value={opt.value}>
                                                        {opt.label}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>

                                    <Button
                                        onClick={handleDownload}
                                        disabled={isDownloading}
                                        className="gap-2"
                                    >
                                        {isDownloading ? (
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : (
                                            <Download className="h-4 w-4" />
                                        )}
                                        {isDownloading ? '下载中...' : '开始下载'}
                                    </Button>
                                </div>

                                {/* 可用格式 */}
                                {videoInfo.formats.length > 0 && (
                                    <div className="mt-3">
                                        <div className="flex flex-wrap gap-1">
                                            {videoInfo.formats.slice(0, 6).map((f) => (
                                                <Badge
                                                    key={f.format_id}
                                                    variant="outline"
                                                    className="text-xs"
                                                >
                                                    {f.display}
                                                    {f.filesize ? ` · ${formatFileSize(f.filesize)}` : ''}
                                                </Badge>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* 下载任务列表 */}
            {downloadTasks.length > 0 && (
                <Card>
                    <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                            <CardTitle className="text-base font-medium">下载任务</CardTitle>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={loadDownloadTasks}
                                className="gap-1"
                            >
                                <RefreshCw className="h-3.5 w-3.5" />
                                刷新
                            </Button>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-3">
                            {downloadTasks.map((task) => (
                                <div
                                    key={task.task_id}
                                    className="p-3 bg-muted/50 rounded-lg space-y-2"
                                >
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2 min-w-0 flex-1">
                                            {task.status === 'completed' && (
                                                <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
                                            )}
                                            {task.status === 'failed' && (
                                                <XCircle className="h-4 w-4 text-destructive shrink-0" />
                                            )}
                                            {(task.status === 'downloading' ||
                                                task.status === 'processing') && (
                                                    <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
                                                )}
                                            {task.status === 'pending' && (
                                                <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
                                            )}
                                            <span className="text-sm font-medium truncate">
                                                {task.title || task.filename || '正在获取...'}
                                            </span>
                                        </div>

                                        <div className="flex items-center gap-1">
                                            {task.status === 'completed' && task.filepath && (
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => handleOpenFolder(task.filepath!)}
                                                >
                                                    <Folder className="h-4 w-4" />
                                                </Button>
                                            )}
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => handleDeleteTask(task.task_id)}
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </div>

                                    {(task.status === 'downloading' ||
                                        task.status === 'processing') && (
                                            <div className="space-y-1">
                                                <Progress value={task.progress} className="h-1.5" />
                                                <div className="flex justify-between text-xs text-muted-foreground">
                                                    <span>
                                                        {task.status === 'processing'
                                                            ? '正在处理...'
                                                            : `${task.progress.toFixed(1)}%`}
                                                    </span>
                                                    {task.speed && <span>{task.speed}</span>}
                                                    {task.eta && <span>剩余 {task.eta}</span>}
                                                </div>
                                            </div>
                                        )}

                                    {task.status === 'failed' && task.error && (
                                        <p className="text-xs text-destructive">{task.error}</p>
                                    )}
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* 提示信息 */}
            <div className="text-center text-xs text-muted-foreground">
                <p>支持 YouTube、Bilibili 及 1000+ 视频网站 · 下载保存至 ~/Downloads/EVA_Videos</p>
            </div>
        </div>
    )
}
