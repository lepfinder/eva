import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { formatServiceLog } from '@/utils/formatServiceLog'
import { cn } from '@/lib/utils'

interface ServiceLogDialogProps {
  open: boolean
  serviceId: string | null
  serviceName: string
  logFile?: string
  onClose: () => void
  onFetchLog: (id: string, lines: number) => Promise<string>
}

export function ServiceLogDialog({
  open,
  serviceId,
  serviceName,
  logFile,
  onClose,
  onFetchLog,
}: ServiceLogDialogProps): React.ReactElement {
  const [raw, setRaw] = useState('')
  const [loading, setLoading] = useState(false)
  const [hideProgress, setHideProgress] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    if (!serviceId) return
    setLoading(true)
    try {
      const content = await onFetchLog(serviceId, 120)
      setRaw(content)
    } finally {
      setLoading(false)
    }
  }, [onFetchLog, serviceId])

  useEffect(() => {
    if (open && serviceId) {
      load()
    }
    if (!open) {
      setRaw('')
    }
  }, [open, serviceId, load])

  useEffect(() => {
    if (!loading && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [raw, hideProgress, loading])

  const lines = formatServiceLog(raw, { hideProgress, maxLines: 200 })

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col gap-3 p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-0 space-y-1">
          <DialogTitle className="flex items-center gap-2">
            <span>{serviceName}</span>
            <span className="text-sm font-normal text-muted-foreground">— 最近日志</span>
          </DialogTitle>
          {logFile && (
            <p className="text-xs font-mono text-muted-foreground truncate" title={logFile}>
              {logFile}
            </p>
          )}
        </DialogHeader>

        <div className="flex items-center justify-between gap-3 px-6">
          <div className="flex items-center gap-2">
            <Checkbox
              id="hide-progress"
              checked={hideProgress}
              onCheckedChange={(v) => setHideProgress(v === true)}
            />
            <Label htmlFor="hide-progress" className="text-sm font-normal cursor-pointer">
              隐藏进度条噪声
            </Label>
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            {loading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            刷新
          </Button>
        </div>

        <div
          ref={scrollRef}
          className={cn(
            'mx-6 mb-6 flex-1 min-h-[320px] max-h-[60vh] overflow-auto rounded-lg border',
            'bg-zinc-950 text-zinc-100 shadow-inner'
          )}
        >
          {loading && lines.length === 0 ? (
            <div className="flex h-full min-h-[200px] items-center justify-center text-zinc-500">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : lines.length === 0 ? (
            <div className="flex h-full min-h-[200px] items-center justify-center text-zinc-500 text-sm">
              (暂无日志内容)
            </div>
          ) : (
            <table className="w-full border-collapse text-[13px] leading-relaxed font-mono">
              <tbody>
                {lines.map((line, idx) => (
                  <tr key={idx} className="hover:bg-zinc-900/80">
                    <td className="select-none w-10 shrink-0 px-3 py-0.5 text-right align-top text-zinc-600 border-r border-zinc-800/80">
                      {idx + 1}
                    </td>
                    <td className="px-3 py-0.5 align-top whitespace-pre-wrap break-words text-zinc-200">
                      {line.trim() === '' ? '\u00a0' : line}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
