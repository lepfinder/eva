/**
 * 内存分析 — 侧栏页面
 */
import { MemoryAnalyzer } from './tools/MemoryAnalyzer'

export function MemoryAnalyzerPage(): React.ReactElement {
  return (
    <div className="h-full min-h-0 overflow-auto">
      <MemoryAnalyzer />
    </div>
  )
}
