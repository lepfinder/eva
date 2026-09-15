/**
 * 本地监听端口 — 侧栏页面
 */
import { LocalPorts } from './tools/LocalPorts'

export function LocalPortsPage(): React.ReactElement {
  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="shrink-0 pb-4">
        <h2 className="text-2xl font-bold">本地监听端口</h2>
        <p className="text-muted-foreground mt-1">查看和管理本机监听中的网络端口</p>
      </div>
      {/* 不要在此层 overflow，否则会裁切 Input 的 focus ring */}
      <div className="flex-1 min-h-0">
        <LocalPorts />
      </div>
    </div>
  )
}
