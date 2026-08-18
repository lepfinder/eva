/**
 * 本地服务管理 — 内置启停 VoxLab / RepoMind
 */
import { useState, useEffect } from 'react'
import {
  RefreshCw,
  Loader2,
  Play,
  Square,
  RotateCcw,
  Globe,
  Server,
  FileText,
  FolderOpen,
  ChevronDown,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  Card, CardContent, CardHeader, CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useLocalServices, ServiceStatus } from '@/hooks/useLocalServices'
import { ServiceLogDialog } from '@/components/services/ServiceLogDialog'
import { formatUptime } from '@/utils/formatUptime'
import cursorIcon from '@/assets/ides/cursor.png'
import antigravityIcon from '@/assets/ides/antigravity.png'
import type { InstalledIdes } from '@/hooks/useLocalServices'

const IDE_OPTIONS = [
  { id: 'cursor' as const, name: 'Cursor', icon: cursorIcon },
  { id: 'antigravity' as const, name: 'Antigravity', icon: antigravityIcon },
]

function defaultIde(ides: InstalledIdes) {
  return IDE_OPTIONS.find((opt) => ides[opt.id]) ?? IDE_OPTIONS[0]
}

function IdeIcon({ src, alt }: { src: string; alt: string }) {
  return (
    <img
      src={src}
      alt={alt}
      className="h-4 w-4 rounded-[3px] object-contain shrink-0"
    />
  )
}

function LiveUptime({ uptimeSecs, active }: { uptimeSecs?: number; active: boolean }) {
  const [live, setLive] = useState(uptimeSecs ?? 0)

  useEffect(() => {
    if (uptimeSecs !== undefined) {
      setLive(uptimeSecs)
    }
  }, [uptimeSecs])

  useEffect(() => {
    if (!active || uptimeSecs === undefined) return
    const timer = setInterval(() => setLive((v) => v + 1), 1000)
    return () => clearInterval(timer)
  }, [active, uptimeSecs])

  if (uptimeSecs === undefined) return <>—</>
  return <>{formatUptime(live)}</>
}

function stateBadge(state: ServiceStatus['state'], health: ServiceStatus['health']) {
  if (state === 'starting') {
    return <Badge variant="secondary">启动中</Badge>
  }
  if (state === 'stopping') {
    return <Badge variant="secondary">停止中</Badge>
  }
  if ((state === 'running' || state === 'partial') && (health === 'ok' || health === 'ports_ok')) {
    return <Badge className="bg-emerald-600 hover:bg-emerald-600">运行中</Badge>
  }
  if (state === 'running' || state === 'partial' || state === 'unhealthy') {
    return <Badge variant="secondary">未就绪</Badge>
  }
  if (state === 'port_conflict') {
    return <Badge variant="destructive">端口冲突</Badge>
  }
  if (state === 'stale_pid') {
    return <Badge variant="outline">PID 过期</Badge>
  }
  return <Badge variant="outline">已停止</Badge>
}

function HealthStatus({ health }: { health: ServiceStatus['health'] }) {
  const display =
    health === 'ok'
      ? { label: '健康', className: 'text-emerald-600 font-medium' }
      : health === 'ports_ok'
        ? { label: '端口就绪', className: 'text-amber-600 font-medium' }
        : health === 'no_response'
          ? { label: '无响应', className: 'text-red-600 font-medium' }
          : { label: '—', className: 'text-muted-foreground' }
  return <p className={`mt-0.5 ${display.className}`}>{display.label}</p>
}

function displayPath(path: string): string {
  // browser-safe HOME fallback for display only
  const home = path.match(/^(\/Users\/[^/]+)/)?.[1]
  if (home && path.startsWith(home)) {
    return `~${path.slice(home.length)}`
  }
  return path
}

function openInFinder(path: string) {
  void window.api.openInFinder(path)
}

export function ServicesPage(): React.ReactElement {
  const { t } = useTranslation()
  const {
    services,
    loading,
    refreshing,
    actionLoading,
    actionMessage,
    error,
    refresh,
    startService,
    stopService,
    restartService,
    openService,
    openInIde,
    ides,
    tailLog,
  } = useLocalServices()

  const [logTarget, setLogTarget] = useState<{ id: string; name: string; logFile?: string } | null>(
    null
  )

  const isBusy = (id: string, actions: string[]) =>
    actions.some((a) => actionLoading === `${a}-${id}`) ||
    services.some(
      (s) =>
        s.id === id &&
        (s.state === 'starting' || s.state === 'stopping')
    )

  const preferredIde = defaultIde(ides)

  return (
    <div className="h-full flex flex-col space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('nav.services')}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            管理本地开发服务，支持启动、停止与健康检查
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refresh()} disabled={refreshing}>
          {refreshing ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          {t('common.refresh')}
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {actionMessage && (
        <div className="rounded-md border bg-muted/50 px-4 py-3 text-sm">{actionMessage}</div>
      )}

      <div className="flex-1 overflow-auto space-y-4">
        {loading && services.length === 0 ? (
          <div className="flex h-[40vh] items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : services.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16">
              <Server className="h-16 w-16 text-muted-foreground/30" />
              <h3 className="mt-4 text-lg font-medium">暂无注册服务</h3>
              <p className="mt-2 text-center text-sm text-muted-foreground">
                请检查 userData/services.json 配置
              </p>
            </CardContent>
          </Card>
        ) : (
          services.map((svc) => (
            <Card key={svc.id} className={svc.health === 'unknown' && refreshing ? 'opacity-80' : undefined}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <CardTitle className="text-lg flex items-center gap-2 flex-wrap">
                      {svc.name}
                      {stateBadge(svc.state, svc.health)}
                      {svc.extras?.managedBy === 'external' && (
                        <Badge variant="outline" className="font-normal">
                          外部启动
                        </Badge>
                      )}
                    </CardTitle>
                    <p className="text-sm text-muted-foreground font-mono">{svc.openUrl}</p>
                    {svc.projectDir && (
                      <div className="flex items-center gap-2 min-w-0">
                        <button
                          type="button"
                          className="flex items-center gap-1.5 min-w-0 text-left text-xs text-muted-foreground hover:text-foreground transition-colors group"
                          title="在 Finder 中打开"
                          onClick={() => openInFinder(svc.projectDir!)}
                        >
                          <FolderOpen className="h-3.5 w-3.5 shrink-0 opacity-70 group-hover:opacity-100" />
                          <span className="font-mono truncate">{displayPath(svc.projectDir)}</span>
                        </button>
                        <div className="flex items-center shrink-0">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-6 px-2 text-xs rounded-r-none border-r-0"
                            disabled={!ides[preferredIde.id]}
                            onClick={() => openInIde(svc.projectDir!, preferredIde.id)}
                          >
                            <IdeIcon src={preferredIde.icon} alt="" />
                            <span className="ml-1">{preferredIde.name}</span>
                          </Button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-6 w-6 px-0 rounded-l-none"
                                title="选择其他 IDE"
                              >
                                <ChevronDown className="h-3 w-3 opacity-70" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {IDE_OPTIONS.map((opt) => (
                                <DropdownMenuItem
                                  key={opt.id}
                                  className="gap-2"
                                  disabled={!ides[opt.id]}
                                  onClick={() => openInIde(svc.projectDir!, opt.id)}
                                >
                                  <IdeIcon src={opt.icon} alt="" />
                                  {opt.name}{!ides[opt.id] ? '（未安装）' : ''}
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2 shrink-0">
                    <Button
                      size="sm"
                      variant="default"
                      disabled={isBusy(svc.id, ['start', 'restart', 'stop'])}
                      onClick={() => startService(svc.id)}
                    >
                      {actionLoading === `start-${svc.id}` ? (
                        <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                      ) : (
                        <Play className="mr-1 h-4 w-4" />
                      )}
                      启动
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isBusy(svc.id, ['start', 'restart', 'stop'])}
                      onClick={() => stopService(svc.id)}
                    >
                      {actionLoading === `stop-${svc.id}` ? (
                        <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                      ) : (
                        <Square className="mr-1 h-4 w-4" />
                      )}
                      停止
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isBusy(svc.id, ['start', 'restart', 'stop'])}
                      onClick={() => restartService(svc.id)}
                    >
                      {actionLoading === `restart-${svc.id}` ? (
                        <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                      ) : (
                        <RotateCcw className="mr-1 h-4 w-4" />
                      )}
                      重启
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={actionLoading === `open-${svc.id}`}
                      onClick={() => openService(svc.id).catch(() => {})}
                    >
                      <Globe className="mr-1 h-4 w-4" />
                      打开
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setLogTarget({ id: svc.id, name: svc.name, logFile: svc.logFile })}
                    >
                      <FileText className="mr-1 h-4 w-4" />
                      日志
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">PID</span>
                    <p className="font-mono mt-0.5">{svc.pid ?? '—'}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">健康</span>
                    <HealthStatus health={svc.health} />
                  </div>
                  <div>
                    <span className="text-muted-foreground">端口</span>
                    <p className="font-mono mt-0.5">
                      {svc.ports.map((p) => (
                        <span key={p.port} className="mr-2">
                          {p.port}
                          {p.listening ? ' ✓' : ''}
                        </span>
                      ))}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">启动时间</span>
                    <p className="font-mono mt-0.5 text-xs leading-relaxed">
                      {svc.startedAt ?? '—'}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">运行时长</span>
                    <p className="mt-0.5">
                      <LiveUptime
                        uptimeSecs={svc.uptimeSecs}
                        active={
                          svc.state === 'running' ||
                          svc.state === 'partial' ||
                          svc.state === 'unhealthy'
                        }
                      />
                    </p>
                  </div>
                  {svc.extras?.frontend && (
                    <div>
                      <span className="text-muted-foreground">前端</span>
                      <p className="mt-0.5">{svc.extras.frontend}</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <ServiceLogDialog
        open={!!logTarget}
        serviceId={logTarget?.id ?? null}
        serviceName={logTarget?.name ?? ''}
        logFile={logTarget?.logFile}
        onClose={() => setLogTarget(null)}
        onFetchLog={tailLog}
      />
    </div>
  )
}
