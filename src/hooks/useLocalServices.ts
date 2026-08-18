import { useState, useCallback, useEffect } from 'react'
import { listen } from '@tauri-apps/api/event'

export interface PortStatus {
  port: number
  listening: boolean
}

export interface ServiceMeta {
  id: string
  name: string
  ports: number[]
  openUrl: string
  projectDir: string
}

export interface ServiceStatus {
  id: string
  name: string
  state: 'stopped' | 'running' | 'starting' | 'stopping' | 'unhealthy' | 'stale_pid' | 'port_conflict' | 'partial'
  pid: number | null
  ports: PortStatus[]
  health: 'ok' | 'ports_ok' | 'no_response' | 'unknown'
  openUrl: string
  logFile: string
  projectDir?: string
  startedAt?: string
  uptimeSecs?: number
  lastError?: string
  extras?: Record<string, string>
}

export interface InstalledIdes {
  cursor: boolean
  antigravity: boolean
}

export interface ServiceActionResult {
  success: boolean
  message: string
}

function placeholderFromMeta(meta: ServiceMeta): ServiceStatus {
  return {
    id: meta.id,
    name: meta.name,
    state: 'stopped',
    pid: null,
    ports: meta.ports.map((port) => ({ port, listening: false })),
    health: 'unknown',
    openUrl: meta.openUrl,
    logFile: '',
    projectDir: meta.projectDir,
  }
}

export function useLocalServices() {
  const [services, setServices] = useState<ServiceStatus[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const [initializing, setInitializing] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const [ides, setIdes] = useState<InstalledIdes>({ cursor: false, antigravity: false })

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      const list = await window.api.services.status()
      setServices(list)
      setError(null)
    } catch (err) {
      console.error('[useLocalServices] refresh failed:', err)
      setError(err instanceof Error ? err.message : '加载服务状态失败')
    } finally {
      setRefreshing(false)
      setInitializing(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    const bootstrap = async () => {
      try {
        const metas: ServiceMeta[] = await window.api.services.list()
        if (!cancelled && metas.length > 0) {
          setServices(metas.map(placeholderFromMeta))
          setInitializing(false)
        }
      } catch (err) {
        console.error('[useLocalServices] list failed:', err)
      }
      if (!cancelled) {
        await refresh()
      }
    }

    void bootstrap()
    window.api.services
      .detectIdes()
      .then((detected: InstalledIdes) => setIdes(detected))
      .catch((err: unknown) => console.error('[useLocalServices] detectIdes failed:', err))
    const interval = setInterval(() => void refresh(), 5000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [refresh])

  const hasPending = services.some(
    (s) => s.state === 'starting' || s.state === 'stopping'
  )

  useEffect(() => {
    if (!hasPending) return
    const fast = setInterval(() => void refresh(), 2000)
    return () => clearInterval(fast)
  }, [hasPending, refresh])

  useEffect(() => {
    let unlisten: (() => void) | null = null
    listen<{ id: string; success: boolean; message: string }>(
      'service:action-complete',
      (event) => {
        setActionMessage(event.payload.message)
        void refresh()
      }
    ).then((fn) => {
      unlisten = fn
    })
    return () => {
      if (unlisten) unlisten()
    }
  }, [refresh])

  const runAction = useCallback(
    async (key: string, fn: () => Promise<ServiceActionResult>) => {
      setActionLoading(key)
      try {
        const result = await fn()
        setActionMessage(result.message)
        void refresh()
        return result
      } finally {
        setActionLoading(null)
      }
    },
    [refresh]
  )

  const startService = useCallback(
    (id: string) => runAction(`start-${id}`, () => window.api.services.start(id)),
    [runAction]
  )

  const stopService = useCallback(
    (id: string, force = false) =>
      runAction(`stop-${id}`, () => window.api.services.stop(id, force)),
    [runAction]
  )

  const restartService = useCallback(
    (id: string) => runAction(`restart-${id}`, () => window.api.services.restart(id)),
    [runAction]
  )

  const openService = useCallback(async (id: string) => {
    setActionLoading(`open-${id}`)
    try {
      await window.api.services.open(id)
    } catch (err) {
      console.error('[useLocalServices] open failed:', err)
      throw err
    } finally {
      setActionLoading(null)
    }
  }, [])

  const openInIde = useCallback(async (path: string, ide: 'cursor' | 'antigravity') => {
    try {
      await window.api.services.openInIde(path, ide)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setActionMessage(message)
      throw err
    }
  }, [])

  const tailLog = useCallback(
    (id: string, lines = 30) => window.api.services.tailLog(id, lines),
    []
  )

  return {
    services,
    loading: initializing,
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
  }
}
