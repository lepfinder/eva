import React, { useState, useEffect } from 'react'
import { FolderSync, Zap, ChevronRight, Loader2, CheckCircle2, AlertTriangle, Pause } from 'lucide-react'
import { mutagenService, MutagenSession } from '@/services/mutagen'

export function QuickSyncCard(): React.ReactElement {
  const [sessions, setSessions] = useState<MutagenSession[]>([])
  const [loading, setLoading] = useState(true)
  const [flushing, setFlushing] = useState(false)

  const loadStatus = async () => {
    try {
      const list = await mutagenService.listSessions()
      setSessions(list)
    } catch {
      setSessions([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadStatus()
    const timer = setInterval(loadStatus, 4000)
    return () => clearInterval(timer)
  }, [])

  const handleCardClick = () => {
    window.dispatchEvent(
      new CustomEvent('navigate-to-page', {
        detail: { page: 'filesync' },
      })
    )
  }

  const handleFlushAll = async (e: React.MouseEvent) => {
    e.stopPropagation()
    setFlushing(true)
    try {
      for (const s of sessions) {
        if (!s.paused) {
          await mutagenService.flushSession(s.identifier).catch(() => {})
        }
      }
      await loadStatus()
    } finally {
      setFlushing(false)
    }
  }

  const watchingCount = sessions.filter((s) => s.status === 'watching' && !s.paused).length
  const issueCount = sessions.filter(
    (s) => s.status === 'halted' || s.lastError || s.status === 'error' || s.status.includes('conflict')
  ).length

  return (
    <div
      onClick={handleCardClick}
      className="group cursor-pointer select-none space-y-2.5 transition-all"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
          <FolderSync className="h-3.5 w-3.5 text-violet-500" />
          <span>双机文件同步 (Mutagen)</span>
        </div>
        <div className="flex items-center gap-1">
          {sessions.length > 0 && (
            <button
              onClick={handleFlushAll}
              disabled={flushing}
              className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-sky-500/10 text-sky-600 dark:text-sky-400 hover:bg-sky-500/20 flex items-center gap-1 transition-all"
              title="立即强制双向刷新同步"
            >
              {flushing ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Zap className="w-3 h-3 fill-current" />
              )}
              <span>立即刷写</span>
            </button>
          )}
          <span className="text-zinc-400 group-hover:text-violet-600 dark:group-hover:text-violet-400 transition-colors flex items-center text-xs">
            <ChevronRight className="h-3.5 w-3.5" />
          </span>
        </div>
      </div>

      <div className="p-3 rounded-xl bg-background/50 border border-black/[0.04] dark:border-white/[0.06] flex items-center justify-between gap-3">
        {loading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-violet-500" />
            <span>检测同步状态中...</span>
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <FolderSync className="w-3.5 h-3.5 text-muted-foreground/60" />
            <span>暂无活跃同步会话，点击创建</span>
          </div>
        ) : (
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-2 text-xs">
              {issueCount > 0 ? (
                <span className="flex items-center gap-1 text-rose-500 font-medium">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {issueCount} 个会话异常/冲突
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-medium">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  {watchingCount}/{sessions.length} 个会话实时监听就绪
                </span>
              )}
            </div>

            <div className="text-[11px] text-muted-foreground font-mono truncate max-w-[150px]">
              {sessions.map((s) => s.name || s.identifier.slice(0, 8)).join(', ')}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
