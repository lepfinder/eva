/**
 * 引导式 Chat：添加项目（选目录 → scan → decision → probe → commit）
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { FolderOpen, Loader2, Plus } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import {
  RegistrationSession,
  pickProjectFolder,
  type ChatMessage,
  type SessionProgress,
  type SessionSnapshot,
} from '@/lib/serviceRegistrationSession'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCommitted: () => void
}

function parsePorts(text: string): number[] {
  return text
    .split(/[,\s]+/)
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0 && n < 65536)
}

function EvaBubble({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex gap-2 items-start', className)}>
      <div className="mt-0.5 h-7 w-7 shrink-0 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold">
        E
      </div>
      <div className="min-w-0 flex-1 rounded-2xl rounded-tl-md border bg-muted/40 px-3 py-2 text-sm leading-relaxed">
        {children}
      </div>
    </div>
  )
}

function UserBubble({ children }: { children: ReactNode }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-tr-md bg-primary text-primary-foreground px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap">
        {children}
      </div>
    </div>
  )
}

function kindLabel(kind: SessionProgress['kind']): string {
  switch (kind) {
    case 'scan':
      return '扫描'
    case 'probe':
      return '试跑'
    case 'ai':
      return 'AI'
    case 'commit':
      return '写入'
    default:
      return '处理'
  }
}

function WorkingProgress({ progress }: { progress: SessionProgress }) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [progress.startedAt, progress.kind])

  const elapsedMs = Math.max(0, now - progress.startedAt)
  const elapsedSec = (elapsedMs / 1000).toFixed(1)
  const expected = progress.expectedMs ?? 30_000
  const pct = Math.min(92, Math.round((elapsedMs / expected) * 100))
  const remainSec = Math.max(0, Math.ceil((expected - elapsedMs) / 1000))

  return (
    <EvaBubble>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
            <span className="font-medium truncate">{progress.label}</span>
          </div>
          <Badge variant="secondary" className="shrink-0 text-[10px] font-normal">
            {kindLabel(progress.kind)}
          </Badge>
        </div>
        {progress.detail && (
          <p className="text-xs text-muted-foreground font-mono truncate" title={progress.detail}>
            {progress.detail}
          </p>
        )}
        <Progress value={pct} className="h-2 [&>div]:bg-primary" />
        <div className="flex justify-between text-[11px] text-muted-foreground tabular-nums">
          <span>已用 {elapsedSec}s</span>
          <span>
            {progress.kind === 'probe'
              ? `约剩 ${remainSec}s（超时上限）`
              : progress.kind === 'ai'
                ? '正在请求模型…'
                : '进行中'}
          </span>
        </div>
      </div>
    </EvaBubble>
  )
}

function MessageView({
  msg,
  pending,
  busy,
  onChoose,
}: {
  msg: ChatMessage
  pending: boolean
  busy: boolean
  onChoose: (id: string, label: string) => void
}) {
  const [logOpen, setLogOpen] = useState(false)

  if (msg.role === 'user') {
    return <UserBubble>{msg.content}</UserBubble>
  }

  return (
    <EvaBubble>
      <div className="whitespace-pre-wrap [&_strong]:font-semibold">{renderMarkdownLite(msg.content)}</div>

      {msg.evidence && msg.evidence.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {msg.evidence.map((e) => (
            <Badge key={e} variant="outline" className="font-normal text-[10px]">
              {e}
            </Badge>
          ))}
        </div>
      )}

      {msg.warnings && msg.warnings.length > 0 && (
        <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-800 dark:text-amber-200">
          {msg.warnings.map((w) => (
            <div key={w}>{w}</div>
          ))}
        </div>
      )}

      {msg.report && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {msg.report.ports.map((p) => (
            <Badge key={p.port} variant={p.listening ? 'default' : 'outline'} className="text-[10px]">
              {p.port} {p.listening ? '✓' : '✗'}
            </Badge>
          ))}
          <Badge variant="secondary" className="text-[10px]">
            {msg.report.health}
          </Badge>
        </div>
      )}

      {msg.collapsedLog && (
        <div className="mt-2">
          <button
            type="button"
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
            onClick={() => setLogOpen((v) => !v)}
          >
            {logOpen ? '收起日志' : '查看日志'}
          </button>
          {logOpen && (
            <pre className="mt-1 max-h-36 overflow-auto rounded-md bg-background/80 p-2 text-[11px] leading-relaxed whitespace-pre-wrap">
              {msg.collapsedLog}
            </pre>
          )}
        </div>
      )}

      {msg.decision && !msg.resolvedChoiceId && pending && (
        <div className="mt-3 flex flex-col gap-2">
          {msg.decision.options.map((opt) => (
            <Button
              key={opt.id}
              type="button"
              size="sm"
              variant={opt.variant ?? 'outline'}
              disabled={busy}
              className="h-auto justify-start whitespace-normal py-2 text-left"
              onClick={() => onChoose(opt.id, opt.label)}
            >
              <span>
                <span className="font-medium">{opt.label}</span>
                {opt.description && (
                  <span className="mt-0.5 block text-xs font-normal opacity-80">{opt.description}</span>
                )}
              </span>
            </Button>
          ))}
        </div>
      )}

      {msg.resolvedChoiceId && (
        <div className="mt-2 text-xs text-muted-foreground">已选择</div>
      )}
    </EvaBubble>
  )
}

function renderMarkdownLite(text: string): ReactNode {
  const parts: ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g
  let last = 0
  let m: RegExpExecArray | null
  let key = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    const token = m[0]
    if (token.startsWith('**')) {
      parts.push(<strong key={key++}>{token.slice(2, -2)}</strong>)
    } else {
      parts.push(
        <code key={key++} className="rounded bg-background/70 px-1 py-0.5 font-mono text-[12px]">
          {token.slice(1, -1)}
        </code>
      )
    }
    last = m.index + token.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

function LandingPicker({
  busy,
  pathInput,
  setPathInput,
  onPick,
  onSubmitPath,
}: {
  busy: boolean
  pathInput: string
  setPathInput: (v: string) => void
  onPick: () => void
  onSubmitPath: () => void
}) {
  const [manual, setManual] = useState(false)

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-8 py-10">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div className="space-y-2">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <FolderOpen className="h-6 w-6" />
          </div>
          <h3 className="text-lg font-semibold tracking-tight">选择项目目录</h3>
          <p className="text-sm text-muted-foreground leading-relaxed">
            选好文件夹后，EVA 会分析、试跑；遇到端口冲突或失败再请你决定。
          </p>
        </div>

        <button
          type="button"
          disabled={busy}
          onClick={onPick}
          className={cn(
            'group flex w-full flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-border bg-muted/30 px-6 py-10 transition-colors',
            'hover:border-primary/50 hover:bg-primary/5',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            'disabled:pointer-events-none disabled:opacity-60'
          )}
        >
          {busy ? (
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          ) : (
            <FolderOpen className="h-8 w-8 text-muted-foreground transition-colors group-hover:text-primary" />
          )}
          <div className="space-y-1">
            <div className="text-sm font-medium">{busy ? '处理中…' : '点击选择目录'}</div>
            <div className="text-xs text-muted-foreground">支持本地任意项目文件夹</div>
          </div>
        </button>

        {!manual ? (
          <button
            type="button"
            className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            onClick={() => setManual(true)}
          >
            或粘贴绝对路径
          </button>
        ) : (
          <div className="flex gap-2 text-left">
            <Input
              value={pathInput}
              onChange={(e) => setPathInput(e.target.value)}
              placeholder="/Users/…/my-project"
              className="font-mono text-sm"
              disabled={busy}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSubmitPath()
              }}
            />
            <Button type="button" disabled={busy || !pathInput.trim()} onClick={onSubmitPath}>
              开始
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

export function RegisterServiceChat({ open, onOpenChange, onCommitted }: Props) {
  const sessionRef = useRef<RegistrationSession | null>(null)
  if (!sessionRef.current) sessionRef.current = new RegistrationSession()

  const [snap, setSnap] = useState<SessionSnapshot>(() => sessionRef.current!.getSnapshot())
  const [pathInput, setPathInput] = useState('')
  const [customPorts, setCustomPorts] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    return sessionRef.current!.subscribe(setSnap)
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [snap.messages.length, snap.pendingDecision?.id, snap.busy, snap.progress?.label])

  useEffect(() => {
    if (snap.phase !== 'committed') return
    const t = setTimeout(() => {
      onOpenChange(false)
      sessionRef.current?.reset()
      setPathInput('')
      setCustomPorts('')
      window.setTimeout(() => {
        onCommitted()
      }, 50)
    }, 450)
    return () => clearTimeout(t)
  }, [snap.phase, onCommitted, onOpenChange])

  const resetAndClose = (v: boolean) => {
    if (v) {
      onOpenChange(true)
      return
    }
    const phase = sessionRef.current?.getSnapshot().phase
    const shouldRefresh = phase === 'committed'
    sessionRef.current?.reset()
    setPathInput('')
    setCustomPorts('')
    onOpenChange(false)
    if (shouldRefresh) {
      window.setTimeout(() => onCommitted(), 50)
    }
  }

  const handlePick = async () => {
    try {
      const dir = await pickProjectFolder()
      if (dir) {
        setPathInput(dir)
        await sessionRef.current!.startWithDir(dir)
      }
    } catch (err) {
      console.error(err)
    }
  }

  const handleStartPath = async () => {
    const dir = pathInput.trim()
    if (!dir) return
    await sessionRef.current!.startWithDir(dir)
  }

  const handleChoose = async (id: string, label: string) => {
    await sessionRef.current!.choose(id, label)
  }

  const handleCustomPorts = async () => {
    const ports = parsePorts(customPorts)
    if (ports.length === 0) return
    await sessionRef.current!.choose(
      'custom_ports',
      `使用端口 ${ports.join(', ')}`,
      ports
    )
    setCustomPorts('')
  }

  const isLanding = snap.phase === 'idle' && !snap.busy && !snap.progress
  const showRestart =
    (snap.phase === 'failed' || snap.phase === 'idle') &&
    !snap.pendingDecision &&
    !isLanding &&
    !snap.busy

  // Skip the canned welcome bubble on the landing screen — copy lives in LandingPicker.
  const chatMessages = isLanding
    ? []
    : snap.messages.filter((m, i) => !(i === 0 && m.role === 'eva' && m.kind === 'text'))

  return (
    <Dialog open={open} onOpenChange={resetAndClose}>
      <DialogContent className="flex h-[min(85vh,640px)] max-w-lg flex-col gap-0 overflow-hidden p-0 sm:rounded-xl">
        <DialogHeader className="shrink-0 border-b px-5 py-4 text-left">
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5" />
            添加项目
          </DialogTitle>
          <DialogDescription>
            {isLanding ? '选择目录即可开始' : '分析 → 选择 → 试跑 → 确认'}
          </DialogDescription>
        </DialogHeader>

        {isLanding ? (
          <LandingPicker
            busy={snap.busy}
            pathInput={pathInput}
            setPathInput={setPathInput}
            onPick={() => void handlePick()}
            onSubmitPath={() => void handleStartPath()}
          />
        ) : (
          <>
            <ScrollArea className="min-h-0 flex-1">
              <div className="flex flex-col gap-4 px-4 py-4">
                {chatMessages.map((msg) => (
                  <MessageView
                    key={msg.id}
                    msg={msg}
                    pending={snap.pendingDecision?.id === msg.decision?.id}
                    busy={snap.busy}
                    onChoose={(id, label) => void handleChoose(id, label)}
                  />
                ))}
                {snap.progress && <WorkingProgress progress={snap.progress} />}
                <div ref={bottomRef} />
              </div>
            </ScrollArea>

            {(snap.pendingDecision?.allowCustomPort || showRestart) && (
              <div className="shrink-0 space-y-2 border-t bg-background px-4 py-3">
                {snap.pendingDecision?.allowCustomPort && (
                  <div className="flex gap-2">
                    <Input
                      value={customPorts}
                      onChange={(e) => setCustomPorts(e.target.value)}
                      placeholder="自定义端口，如 3010, 3011"
                      className="font-mono text-sm"
                      disabled={snap.busy}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void handleCustomPorts()
                      }}
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={snap.busy || parsePorts(customPorts).length === 0}
                      onClick={() => void handleCustomPorts()}
                    >
                      使用
                    </Button>
                  </div>
                )}
                {showRestart && (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    disabled={snap.busy}
                    onClick={() => {
                      sessionRef.current?.reset()
                      setPathInput('')
                      setCustomPorts('')
                    }}
                  >
                    <FolderOpen className="mr-2 h-4 w-4" />
                    重新选择目录
                  </Button>
                )}
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
