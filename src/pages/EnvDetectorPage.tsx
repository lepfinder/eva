/**
 * 环境探测 — 侧栏页面
 */
import { EnvDetector } from './tools/EnvDetector'

export function EnvDetectorPage(): React.ReactElement {
  return (
    <div className="h-full min-h-0 overflow-auto">
      <EnvDetector />
    </div>
  )
}
