/**
 * 工具箱页面
 */
import { useState, useEffect } from 'react'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { JsonFormatter } from './tools/JsonFormatter'
import { ListDeduplicator } from './tools/ListDeduplicator'
import { SetOperations } from './tools/SetOperations'
import { TimestampConverter } from './tools/TimestampConverter'
import { PasswordGenerator } from './tools/PasswordGenerator'
import { SqlGenerator } from './tools/SqlGenerator'
import { ColorPicker } from './tools/ColorPicker'
import { CheatSheetPage } from './CheatSheetPage'
import { recordToolUsage } from '@/utils/toolUsage'
import { toolboxTools, type ToolId, type ToolConfig } from '@/lib/toolCatalog'

/** @deprecated 使用 ToolId；保留别名以兼容旧引用 */
export type ToolType = ToolId | 'list'

/** 兼容旧 import：快捷入口请改用 allTools */
export const tools: ToolConfig[] = toolboxTools

const TOOL_TITLE_MAP: Partial<Record<ToolType, string>> = Object.fromEntries(
  toolboxTools.map((t) => [t.id, t.title])
)

interface ToolboxPageProps {
  onSubTitleChange?: (title: string | null) => void
}

export function ToolboxPage({ onSubTitleChange }: ToolboxPageProps): React.ReactElement {
  const [currentTool, setCurrentTool] = useState<ToolType>('list')

  useEffect(() => {
    if (onSubTitleChange) {
      onSubTitleChange(TOOL_TITLE_MAP[currentTool] || null)
    }
  }, [currentTool, onSubTitleChange])

  useEffect(() => {
    const handleOpenTool = (e: Event) => {
      const customEvent = e as CustomEvent<{ toolId: ToolType }>
      const toolId = customEvent.detail?.toolId

      if (toolId && toolId !== 'list' && toolboxTools.some((t) => t.id === toolId)) {
        handleToolClick(toolId)
      }
    }

    window.addEventListener('open-tool', handleOpenTool)
    return () => window.removeEventListener('open-tool', handleOpenTool)
  }, [])

  const handleToolClick = (toolId: ToolType) => {
    if (toolId !== 'list') {
      recordToolUsage(toolId)
    }
    setCurrentTool(toolId)
  }

  const renderToolList = () => (
    <div className="h-full flex flex-col">
      <div className="shrink-0 pb-4">
        <h2 className="text-2xl font-bold">工具箱</h2>
        <p className="text-muted-foreground mt-1">常用开发工具集合</p>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {toolboxTools.map((tool) => (
            <Card
              key={tool.id}
              className="cursor-pointer hover:shadow-lg transition-shadow hover:border-primary/50"
              onClick={() => handleToolClick(tool.id)}
            >
              <CardHeader className="pb-3">
                <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center text-primary mb-3">
                  {tool.icon}
                </div>
                <CardTitle className="text-lg">{tool.title}</CardTitle>
                <CardDescription>{tool.description}</CardDescription>
              </CardHeader>
            </Card>
          ))}

          <Card className="border-dashed opacity-50">
            <CardHeader className="pb-3">
              <div className="h-12 w-12 rounded-lg bg-muted flex items-center justify-center text-muted-foreground mb-3">
                <span className="text-2xl">+</span>
              </div>
              <CardTitle className="text-lg text-muted-foreground">更多工具</CardTitle>
              <CardDescription>即将推出...</CardDescription>
            </CardHeader>
          </Card>
        </div>
      </div>
    </div>
  )

  const renderTool = () => {
    const tool = toolboxTools.find((t) => t.id === currentTool)
    if (!tool) return null

    return (
      <div className="h-full flex flex-col -mt-6 -mx-6">
        <div
          className="shrink-0 h-12 px-6 flex items-center gap-3 border-b bg-background drag-region"
          data-tauri-drag-region
        >
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setCurrentTool('list')}
            className="no-drag h-8 w-8"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="no-drag flex items-center gap-2">
            <div className="h-6 w-6 rounded bg-primary/10 flex items-center justify-center text-primary">
              {tool.icon}
            </div>
            <span className="font-medium">{tool.title}</span>
          </div>
        </div>

        <div className="flex-1 min-h-0 p-6">
          {currentTool === 'json-formatter' && <JsonFormatter />}
          {currentTool === 'list-dedup' && <ListDeduplicator />}
          {currentTool === 'set-ops' && <SetOperations />}
          {currentTool === 'timestamp' && <TimestampConverter />}
          {currentTool === 'password-generator' && <PasswordGenerator />}
          {currentTool === 'sql-generator' && <SqlGenerator />}
          {currentTool === 'color-picker' && <ColorPicker />}
          {currentTool === 'cheatsheet' && <CheatSheetPage />}
        </div>
      </div>
    )
  }

  return <div className="h-full">{currentTool === 'list' ? renderToolList() : renderTool()}</div>
}
