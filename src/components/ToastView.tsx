import { useEffect, useState } from 'react'
import { Check, TriangleAlert } from 'lucide-react'

interface ToastPayload {
  seq: number
  kind: 'ok' | 'warn'
  title: string
  body: string
}

declare global {
  interface Window {
    __EVA_TOAST__?: ToastPayload | null
  }
}

export function ToastView(): React.ReactElement | null {
  const [toast, setToast] = useState<ToastPayload | null>(window.__EVA_TOAST__ ?? null)

  useEffect(() => {
    // Rust 侧用 eval 注入内容并派发该事件：窗口常驻隐藏时 WKWebView 不跑 JS，
    // Tauri 事件监听注册不上，只有原生求值能把文案送进来。
    const sync = () => setToast(window.__EVA_TOAST__ ?? null)
    window.addEventListener('eva-toast', sync)
    return () => window.removeEventListener('eva-toast', sync)
  }, [])

  if (!toast) {
    return <div className="h-screen w-screen bg-transparent" />
  }

  // 路径按最后一段拆开，目录可截断、文件名始终完整可见
  const slash = toast.body.lastIndexOf('/')
  const dir = slash > 0 ? `${toast.body.slice(0, slash)}/` : ''
  const name = slash > 0 ? toast.body.slice(slash + 1) : toast.body

  return (
    <div className="flex h-screen w-screen items-center bg-transparent px-3 py-2.5">
      <div
        key={toast.seq}
        className="flex w-full items-center gap-3 rounded-2xl bg-[#1f1f22]/95 px-4 py-3 shadow-[0_10px_30px_rgba(0,0,0,0.35)]"
        style={{ animation: 'toastIn 140ms ease-out' }}
      >
        {toast.kind === 'ok' ? (
          <Check className="h-5 w-5 shrink-0 text-zinc-50" strokeWidth={2.4} />
        ) : (
          <TriangleAlert className="h-5 w-5 shrink-0 text-zinc-50" strokeWidth={2.2} />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium leading-tight text-zinc-100">
            {toast.title}
          </div>
          {toast.body && (
            <div className="mt-1 flex min-w-0 items-baseline font-mono text-[11px] leading-tight">
              {dir && <span className="truncate text-zinc-500">{dir}</span>}
              <span className="shrink-0 truncate text-zinc-300">{name}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
