import React, { useState, useEffect, useCallback, useMemo } from 'react'
import {
  FolderSync,
  RefreshCw,
  Zap,
  Play,
  Pause,
  RotateCcw,
  Trash2,
  Plus,
  Laptop,
  Server,
  AlertTriangle,
  Loader2,
  Copy,
  Check,
  Network,
  ChevronDown,
  ChevronUp,
  SlidersHorizontal,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  mutagenService,
  MutagenSession,
  MutagenStatus,
  CreateSessionPayload,
} from '@/services/mutagen'

// 模块级缓存，实现切页 0 延迟秒开 (SWR 策略)
let memorySessions: MutagenSession[] = []
let memoryStatus: MutagenStatus | null = null
let hasLoadedOnce = false

// 常用项目类型的预设忽略规则
const IGNORE_PRESETS: Record<string, { label: string; rules: string[] }> = {
  web: {
    label: 'Web / Node.js',
    rules: ['node_modules', '.git', 'dist', 'build', '.next', '.turbo', '.cache'],
  },
  rust: {
    label: 'Rust / Cargo',
    rules: ['target', '.git'],
  },
  python: {
    label: 'Python / AI',
    rules: ['__pycache__', '.venv', 'venv', '*.pyc', '*.pt', '*.bin', '*.safetensors', '.git'],
  },
  general: {
    label: '通用代码库',
    rules: ['.git', '.DS_Store', '*.log', 'tmp', 'temp'],
  },
}

function formatBytes(bytes?: number): string {
  if (bytes === undefined || bytes === null || bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

export function FileSyncPage(): React.ReactElement {
  // 使用模块缓存做首帧渲染，彻底消除切页闪烁和等待感
  const [sessions, setSessions] = useState<MutagenSession[]>(memorySessions)
  const [status, setStatus] = useState<MutagenStatus | null>(memoryStatus)
  const [loading, setLoading] = useState(!hasLoadedOnce && memorySessions.length === 0)
  const [refreshing, setRefreshing] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [expandedIgnores, setExpandedIgnores] = useState<Record<string, boolean>>({})

  // 新建弹窗状态
  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState<CreateSessionPayload>({
    name: '',
    alphaPath: '',
    betaTarget: '',
    syncMode: 'two-way-resolved',
    ignorePaths: [...IGNORE_PRESETS.web.rules],
  })
  const [selectedPreset, setSelectedPreset] = useState<string>('web')
  const [sshTesting, setSshTesting] = useState(false)
  const [sshTestResult, setSshTestResult] = useState<{ success: boolean; msg: string } | null>(null)
  const [createError, setCreateError] = useState<string | null>(null)

  // 加载数据
  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true)
    try {
      const [st, sessList] = await Promise.all([
        mutagenService.getStatus(),
        mutagenService.listSessions().catch(() => [] as MutagenSession[]),
      ])
      memoryStatus = st
      memorySessions = sessList
      hasLoadedOnce = true
      setStatus(st)
      setSessions(sessList)
    } catch (err) {
      console.error('[FileSync] 获取状态失败:', err)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  // 初始静默加载与定时心跳
  useEffect(() => {
    fetchData(hasLoadedOnce)
    const timer = setInterval(() => {
      fetchData(true)
    }, 3000)
    return () => clearInterval(timer)
  }, [fetchData])

  const copyText = (text: string, id: string) => {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 1500)
  }

  // 统计指标
  const stats = useMemo(() => {
    const total = sessions.length
    const watching = sessions.filter((s) => s.status === 'watching' && !s.paused).length
    const paused = sessions.filter((s) => s.paused || s.status === 'paused').length
    const issues = sessions.filter(
      (s) => s.status === 'halted' || s.lastError || s.status === 'error' || s.status.includes('conflict')
    ).length
    return { total, watching, paused, issues }
  }, [sessions])

  const handleFlush = async (sessionId: string) => {
    setActionLoading(`flush-${sessionId}`)
    try {
      await mutagenService.flushSession(sessionId)
      await fetchData(true)
    } catch (err: unknown) {
      alert(`刷写失败: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setActionLoading(null)
    }
  }

  const handleFlushAll = async () => {
    setActionLoading('flush-all')
    try {
      for (const s of sessions) {
        if (!s.paused) {
          await mutagenService.flushSession(s.identifier).catch(() => {})
        }
      }
      await fetchData(true)
    } finally {
      setActionLoading(null)
    }
  }

  const handleTogglePause = async (session: MutagenSession) => {
    const id = session.identifier
    const isPaused = session.paused || session.status === 'paused'
    setActionLoading(`toggle-${id}`)
    try {
      if (isPaused) {
        await mutagenService.resumeSession(id)
      } else {
        await mutagenService.pauseSession(id)
      }
      await fetchData(true)
    } catch (err: unknown) {
      alert(`操作失败: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setActionLoading(null)
    }
  }

  const handleReset = async (sessionId: string) => {
    if (!window.confirm('重置会话将重新扫描两端文件树并重新协商同步状态，确认重置吗？')) {
      return
    }
    setActionLoading(`reset-${sessionId}`)
    try {
      await mutagenService.resetSession(sessionId)
      await fetchData(true)
    } catch (err: unknown) {
      alert(`重置失败: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setActionLoading(null)
    }
  }

  const handleTerminate = async (sessionId: string, name?: string) => {
    if (!window.confirm(`确定要解绑并删除同步会话【${name || sessionId}】吗？本地和远程文件不会被删除。`)) {
      return
    }
    setActionLoading(`term-${sessionId}`)
    try {
      await mutagenService.terminateSession(sessionId)
      await fetchData(true)
    } catch (err: unknown) {
      alert(`删除失败: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setActionLoading(null)
    }
  }

  const handleTestSsh = async () => {
    if (!createForm.betaTarget.trim()) {
      setSshTestResult({ success: false, msg: '请先输入远程目标地址 (如 xiexiyang@10.1.4.42:...)' })
      return
    }
    setSshTesting(true)
    setSshTestResult(null)
    try {
      const res = await mutagenService.testSsh(createForm.betaTarget.trim())
      setSshTestResult({ success: true, msg: res.message })
    } catch (err: unknown) {
      setSshTestResult({ success: false, msg: String(err) })
    } finally {
      setSshTesting(false)
    }
  }

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreateError(null)

    if (!createForm.name.trim()) {
      setCreateError('请输入会话名称')
      return
    }
    if (!createForm.alphaPath.trim()) {
      setCreateError('请输入本地工作区路径')
      return
    }
    if (!createForm.betaTarget.trim()) {
      setCreateError('请输入远程或目标端路径')
      return
    }

    setActionLoading('creating')
    try {
      await mutagenService.createSession(createForm)
      setCreateOpen(false)
      setCreateForm({
        name: '',
        alphaPath: '',
        betaTarget: '',
        syncMode: 'two-way-resolved',
        ignorePaths: [...IGNORE_PRESETS.web.rules],
      })
      await fetchData(true)
    } catch (err: unknown) {
      setCreateError(String(err))
    } finally {
      setActionLoading(null)
    }
  }

  const handlePresetChange = (presetKey: string) => {
    setSelectedPreset(presetKey)
    if (IGNORE_PRESETS[presetKey]) {
      setCreateForm((prev) => ({
        ...prev,
        ignorePaths: [...IGNORE_PRESETS[presetKey].rules],
      }))
    }
  }

  const renderStatusBadge = (session: MutagenSession) => {
    const isPaused = session.paused || session.status === 'paused'
    if (isPaused) {
      return (
        <Badge variant="outline" className="bg-amber-500/10 text-amber-500 border-amber-500/30 gap-1.5 py-0.5 font-normal text-xs">
          <Pause className="w-3 h-3" /> 已暂停
        </Badge>
      )
    }

    switch (session.status) {
      case 'watching':
        return (
          <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/30 gap-1.5 py-0.5 font-normal text-xs">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            监听中 (Watching)
          </Badge>
        )
      case 'reconciling':
      case 'scanning':
      case 'transitioning':
        return (
          <Badge variant="outline" className="bg-sky-500/10 text-sky-500 border-sky-500/30 gap-1.5 py-0.5 font-normal text-xs">
            <Loader2 className="w-3 h-3 animate-spin" />
            计算中 ({session.status})
          </Badge>
        )
      case 'halted':
      case 'error':
        return (
          <Badge variant="outline" className="bg-rose-500/10 text-rose-500 border-rose-500/30 gap-1.5 py-0.5 font-normal text-xs">
            <AlertTriangle className="w-3 h-3" />
            异常挂起 (Halted)
          </Badge>
        )
      default:
        return (
          <Badge variant="outline" className="text-muted-foreground border-border gap-1 py-0.5 font-normal text-xs">
            {session.status}
          </Badge>
        )
    }
  }

  return (
    <div className="h-full flex flex-col min-h-0 space-y-4">
      {/* 头部：与 LocalPorts / TimeAuditor 规范完全统一 */}
      <div className="shrink-0 pb-3 border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold flex items-center gap-2 text-zinc-900 dark:text-zinc-100">
              文件同步中心
              {status?.installed ? (
                <Badge variant="secondary" className="text-xs font-mono font-normal">
                  v{status.version}
                </Badge>
              ) : (
                <Badge variant="destructive" className="text-xs">
                  未检测到 Mutagen
                </Badge>
              )}
            </h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
              基于 Mutagen 的双机文件实时同步、健康感知与冲突保护
            </p>
          </div>

          <div className="flex items-center gap-2">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => fetchData(false)}
                    disabled={refreshing}
                    className="h-8 gap-1.5 text-xs"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                    刷新
                  </Button>
                </TooltipTrigger>
                <TooltipContent>重新获取所有同步会话状态</TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <Button
              variant="outline"
              size="sm"
              onClick={handleFlushAll}
              disabled={sessions.length === 0 || actionLoading === 'flush-all'}
              className="h-8 gap-1.5 text-xs text-sky-600 dark:text-sky-400 border-sky-500/20 hover:bg-sky-500/10"
            >
              {actionLoading === 'flush-all' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Zap className="w-3.5 h-3.5 fill-current" />
              )}
              全部立即刷写
            </Button>

            <Button
              size="sm"
              onClick={() => {
                setCreateError(null)
                setSshTestResult(null)
                setCreateOpen(true)
              }}
              disabled={!status?.installed}
              className="h-8 gap-1.5 text-xs bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white shadow-sm"
            >
              <Plus className="w-3.5 h-3.5" />
              新建同步任务
            </Button>
          </div>
        </div>
      </div>

      {/* Mutagen 未安装引导 */}
      {status && !status.installed && (
        <Card className="border-amber-500/30 bg-amber-500/5 shrink-0">
          <CardContent className="p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 font-semibold text-sm">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                系统尚未安装 Mutagen CLI 工具
              </div>
              <p className="text-xs text-muted-foreground">
                Mutagen 是双机与容器高效文件同步的基石。在终端运行 Homebrew 命令即可一键安装：
              </p>
            </div>
            <div className="flex items-center gap-2 w-full md:w-auto">
              <code className="px-2.5 py-1 rounded bg-background border text-xs font-mono">
                brew install mutagen-io/mutagen/mutagen
              </code>
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2"
                onClick={() => copyText('brew install mutagen-io/mutagen/mutagen', 'brew')}
              >
                {copiedId === 'brew' ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 状态统计卡片 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 shrink-0">
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-card/60 p-3.5">
          <div className="text-xs font-medium text-zinc-500">总同步会话</div>
          <div className="text-2xl font-bold mt-0.5 text-foreground">{stats.total}</div>
        </div>
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-card/60 p-3.5">
          <div className="text-xs font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            实时监听中
          </div>
          <div className="text-2xl font-bold mt-0.5 text-emerald-600 dark:text-emerald-400">{stats.watching}</div>
        </div>
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-card/60 p-3.5">
          <div className="text-xs font-medium text-amber-500 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            暂停同步
          </div>
          <div className="text-2xl font-bold mt-0.5 text-amber-500">{stats.paused}</div>
        </div>
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-card/60 p-3.5">
          <div className="text-xs font-medium text-rose-500 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
            异常/冲突
          </div>
          <div className="text-2xl font-bold mt-0.5 text-rose-500">{stats.issues}</div>
        </div>
      </div>

      {/* 会话列表区域 */}
      <div className="flex-1 min-h-0 overflow-y-auto space-y-3 pr-1">
        {loading ? (
          <div className="h-48 flex flex-col items-center justify-center text-muted-foreground gap-2">
            <Loader2 className="w-6 h-6 animate-spin text-violet-500" />
            <p className="text-xs">加载同步会话中...</p>
          </div>
        ) : sessions.length === 0 ? (
          <div className="h-64 border border-dashed rounded-xl flex flex-col items-center justify-center text-center p-6 text-muted-foreground bg-card/20">
            <FolderSync className="w-10 h-10 text-muted-foreground/30 mb-2" />
            <h3 className="text-base font-semibold text-foreground">暂无活跃的同步会话</h3>
            <p className="text-xs max-w-sm mt-1 mb-4">
              点击下方按钮创建第一个双机同步任务，支持在本地电脑与局域网开发机（如 10.1.4.42）之间实时同步代码。
            </p>
            <Button
              size="sm"
              onClick={() => {
                setCreateError(null)
                setSshTestResult(null)
                setCreateOpen(true)
              }}
              disabled={!status?.installed}
              className="gap-1.5 text-xs"
            >
              <Plus className="w-3.5 h-3.5" />
              新建同步会话
            </Button>
          </div>
        ) : (
          sessions.map((session) => {
            const isPaused = session.paused || session.status === 'paused'
            const isFlushing = actionLoading === `flush-${session.identifier}`
            const isToggling = actionLoading === `toggle-${session.identifier}`
            const isResetting = actionLoading === `reset-${session.identifier}`
            const isDeleting = actionLoading === `term-${session.identifier}`
            const isIgnoreExpanded = !!expandedIgnores[session.identifier]

            const alphaFiles = session.alpha.files ?? 0
            const alphaDirs = session.alpha.directories ?? 0
            const alphaSize = session.alpha.totalFileSize ?? 0

            const betaFiles = session.beta.files ?? 0
            const betaDirs = session.beta.directories ?? 0
            const betaSize = session.beta.totalFileSize ?? 0

            const betaTargetDisplay = session.beta.host
              ? `${session.beta.user ? `${session.beta.user}@` : ''}${session.beta.host}`
              : '本地目标'

            return (
              <Card
                key={session.identifier}
                className="overflow-hidden border border-zinc-200 dark:border-zinc-800 bg-card/60 shadow-sm"
              >
                {/* 会话顶部信息 */}
                <div className="px-4 py-2.5 bg-muted/30 border-b border-border/50 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className="font-semibold text-sm text-foreground">
                      {session.name || '未命名会话'}
                    </span>
                    {renderStatusBadge(session)}
                    <Badge variant="outline" className="text-[11px] text-muted-foreground font-mono font-normal">
                      {session.mode || 'two-way-resolved'}
                    </Badge>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs font-mono text-muted-foreground hover:text-foreground"
                            onClick={() => copyText(session.identifier, session.identifier)}
                          >
                            {session.identifier.slice(0, 14)}...
                            {copiedId === session.identifier ? (
                              <Check className="w-3 h-3 ml-1 text-emerald-500" />
                            ) : (
                              <Copy className="w-3 h-3 ml-1" />
                            )}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>点击复制完整 Identifier</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>

                    <div className="flex items-center gap-1 border-l pl-1.5 ml-0.5 border-border/50">
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-sky-600 dark:text-sky-400 hover:bg-sky-500/10 gap-1 text-xs"
                              disabled={isFlushing || isPaused}
                              onClick={() => handleFlush(session.identifier)}
                            >
                              {isFlushing ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <Zap className="w-3 h-3 fill-current" />
                              )}
                              <span>刷写</span>
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>强制立即触发双向检查并完成同步 (Flush)</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>

                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                              disabled={isToggling}
                              onClick={() => handleTogglePause(session)}
                            >
                              {isToggling ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : isPaused ? (
                                <Play className="w-3 h-3 text-emerald-500" />
                              ) : (
                                <Pause className="w-3 h-3" />
                              )}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{isPaused ? '恢复同步' : '暂停同步'}</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>

                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                              disabled={isResetting}
                              onClick={() => handleReset(session.identifier)}
                            >
                              {isResetting ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <RotateCcw className="w-3 h-3" />
                              )}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>重置同步会话状态</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>

                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-rose-500 hover:bg-rose-500/10"
                              disabled={isDeleting}
                              onClick={() => handleTerminate(session.identifier, session.name)}
                            >
                              {isDeleting ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <Trash2 className="w-3 h-3" />
                              )}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>解绑并删除此会话</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                  </div>
                </div>

                {/* 会话内容：双机拓扑图 */}
                <CardContent className="p-4">
                  <div className="grid grid-cols-1 md:grid-cols-7 gap-3 items-center">
                    {/* 左端：Alpha 本机 */}
                    <div className="md:col-span-3 rounded-lg p-3 bg-muted/20 border border-border/40 space-y-1.5">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span className="flex items-center gap-1.5 font-medium text-foreground">
                          <Laptop className="w-3.5 h-3.5 text-violet-500" /> Alpha (本地工作区)
                        </span>
                        <Badge
                          variant="outline"
                          className={
                            session.alpha.connected !== false
                              ? 'text-emerald-500 border-emerald-500/30 text-[10px] font-normal px-1.5 py-0'
                              : 'text-rose-500 border-rose-500/30 text-[10px] font-normal px-1.5 py-0'
                          }
                        >
                          {session.alpha.connected !== false ? '已连接' : '未连接'}
                        </Badge>
                      </div>

                      <div className="font-mono text-xs text-foreground break-all bg-background/60 p-2 rounded border border-border/40 select-text">
                        {session.alpha.path || '-'}
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                        <span>
                          {alphaDirs} 目录 · {alphaFiles} 文件
                        </span>
                        <span className="font-mono">{formatBytes(alphaSize)}</span>
                      </div>
                    </div>

                    {/* 中间：连接指示桥 */}
                    <div className="md:col-span-1 flex flex-col items-center justify-center py-1 text-center">
                      <div className="w-full flex items-center justify-center relative">
                        <div className="h-0.5 w-full bg-border/60 absolute" />
                        <div
                          className={`z-10 p-1.5 rounded-full border bg-background shadow-xs ${
                            isPaused
                              ? 'border-amber-500/40 text-amber-500'
                              : 'border-emerald-500/40 text-emerald-500'
                          }`}
                        >
                          <Network className="w-3.5 h-3.5" />
                        </div>
                      </div>
                      <span className="text-[10px] font-mono text-muted-foreground mt-1">
                        {session.beta.protocol?.toUpperCase() || 'SSH'}
                      </span>
                      {session.successfulCycles !== undefined && (
                        <span className="text-[9px] text-muted-foreground/70">
                          周期: {session.successfulCycles}
                        </span>
                      )}
                    </div>

                    {/* 右端：Beta 目标/远端 */}
                    <div className="md:col-span-3 rounded-lg p-3 bg-muted/20 border border-border/40 space-y-1.5">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span className="flex items-center gap-1.5 font-medium text-foreground">
                          <Server className="w-3.5 h-3.5 text-sky-500" /> Beta ({betaTargetDisplay})
                        </span>
                        <Badge
                          variant="outline"
                          className={
                            session.beta.connected !== false
                              ? 'text-emerald-500 border-emerald-500/30 text-[10px] font-normal px-1.5 py-0'
                              : 'text-rose-500 border-rose-500/30 text-[10px] font-normal px-1.5 py-0'
                          }
                        >
                          {session.beta.connected !== false ? '已连接' : '未连接'}
                        </Badge>
                      </div>

                      <div className="font-mono text-xs text-foreground break-all bg-background/60 p-2 rounded border border-border/40 select-text">
                        {session.beta.path || '-'}
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                        <span>
                          {betaDirs} 目录 · {betaFiles} 文件
                        </span>
                        <span className="font-mono">{formatBytes(betaSize)}</span>
                      </div>
                    </div>
                  </div>

                  {session.lastError && (
                    <div className="mt-2.5 p-2 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 text-xs flex items-start gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <div>
                        <span className="font-semibold">同步异常警告：</span>
                        <span className="font-mono ml-1">{session.lastError}</span>
                      </div>
                    </div>
                  )}

                  {session.ignore?.paths && session.ignore.paths.length > 0 && (
                    <div className="mt-2.5 pt-2 border-t border-border/40">
                      <button
                        onClick={() =>
                          setExpandedIgnores((prev) => ({
                            ...prev,
                            [session.identifier]: !prev[session.identifier],
                          }))
                        }
                        className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
                      >
                        <SlidersHorizontal className="w-3 h-3" />
                        <span>忽略规则 ({session.ignore.paths.length} 项)</span>
                        {isIgnoreExpanded ? (
                          <ChevronUp className="w-3 h-3" />
                        ) : (
                          <ChevronDown className="w-3 h-3" />
                        )}
                      </button>

                      {isIgnoreExpanded && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {session.ignore.paths.map((p, idx) => (
                            <span
                              key={idx}
                              className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono text-muted-foreground border border-border/50"
                            >
                              {p}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })
        )}
      </div>

      {/* 新建同步任务 Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-[580px] max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <FolderSync className="w-4 h-4 text-violet-500" />
              创建新 Mutagen 同步会话
            </DialogTitle>
            <DialogDescription className="text-xs">
              在两台电脑或本地与远程服务器之间建立双向实时文件同步任务。
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateSubmit} className="space-y-3.5 py-1 text-xs">
            {createError && (
              <div className="p-2.5 rounded bg-rose-500/10 border border-rose-500/20 text-rose-500 text-xs">
                {createError}
              </div>
            )}

            <div className="space-y-1">
              <label className="font-semibold text-foreground">会话名称 (Name)</label>
              <Input
                placeholder="例如: xiaonuan-agent, agent-shots"
                value={createForm.name}
                onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                className="h-8 text-xs"
                required
              />
            </div>

            <div className="space-y-1">
              <label className="font-semibold text-foreground">Alpha 本地工作区绝对路径</label>
              <Input
                placeholder="/Users/xiyangxie/workspace/..."
                value={createForm.alphaPath}
                onChange={(e) => setCreateForm({ ...createForm, alphaPath: e.target.value })}
                className="h-8 text-xs"
                required
              />
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="font-semibold text-foreground">Beta 目标端 (SSH user@host:path 或 本地路径)</label>
                <button
                  type="button"
                  onClick={handleTestSsh}
                  disabled={sshTesting || !createForm.betaTarget.includes('@')}
                  className="text-violet-600 dark:text-violet-400 hover:underline flex items-center gap-1 disabled:opacity-50"
                >
                  {sshTesting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Network className="w-3 h-3" />}
                  测试 SSH 连通性
                </button>
              </div>
              <Input
                placeholder="例如: xiexiyang@10.1.4.42:~/workspace/personal/xiaonuan-agent"
                value={createForm.betaTarget}
                onChange={(e) => {
                  setCreateForm({ ...createForm, betaTarget: e.target.value })
                  setSshTestResult(null)
                }}
                className="h-8 text-xs"
                required
              />
              {sshTestResult && (
                <div
                  className={`text-[11px] p-2 rounded ${
                    sshTestResult.success
                      ? 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20'
                      : 'bg-rose-500/10 text-rose-500 border border-rose-500/20'
                  }`}
                >
                  {sshTestResult.msg}
                </div>
              )}
            </div>

            <div className="space-y-1">
              <label className="font-semibold text-foreground">项目类型与忽略预设</label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                {Object.entries(IGNORE_PRESETS).map(([key, item]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => handlePresetChange(key)}
                    className={`p-1.5 rounded border text-left text-xs transition-all ${
                      selectedPreset === key
                        ? 'border-violet-500 bg-violet-500/10 font-semibold text-violet-600 dark:text-violet-400'
                        : 'border-border hover:bg-muted/50 text-muted-foreground'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1">
              <label className="font-semibold text-foreground">忽略规则 (每行一条规则)</label>
              <textarea
                className="w-full h-20 p-2 rounded border border-input bg-transparent font-mono text-xs resize-none focus:outline-none focus:ring-1 focus:ring-violet-500"
                value={createForm.ignorePaths?.join('\n') || ''}
                onChange={(e) =>
                  setCreateForm({
                    ...createForm,
                    ignorePaths: e.target.value
                      .split('\n')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
              />
            </div>

            <div className="space-y-1">
              <label className="font-semibold text-foreground">同步模式</label>
              <select
                className="w-full h-8 px-2 rounded border border-input bg-background text-xs focus:outline-none focus:ring-1 focus:ring-violet-500"
                value={createForm.syncMode}
                onChange={(e) => setCreateForm({ ...createForm, syncMode: e.target.value })}
              >
                <option value="two-way-resolved">two-way-resolved (推荐双向自动解决)</option>
                <option value="two-way-safe">two-way-safe (双向安全模式)</option>
                <option value="one-way-safe">one-way-safe (单向安全备份)</option>
                <option value="one-way-replica">one-way-replica (单向完全覆盖镜像)</option>
              </select>
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setCreateOpen(false)}>
                取消
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={actionLoading === 'creating'}
                className="bg-violet-600 hover:bg-violet-500 text-white gap-1.5"
              >
                {actionLoading === 'creating' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                创建并开始同步
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
export default FileSyncPage
