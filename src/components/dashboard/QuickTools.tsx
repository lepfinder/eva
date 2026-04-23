import { useState, useEffect } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { tools, ToolType } from '@/pages/ToolboxPage'
import { getMostUsedTools } from '@/utils/toolUsage'
import { cloneElement } from 'react'

export function QuickTools(): React.ReactElement {
    const [topTools, setTopTools] = useState<typeof tools>([])

    const loadTopTools = () => {
        // 获取最常用的工具ID
        const stats = getMostUsedTools(6)

        if (stats.length === 0) {
            // 如果没有统计数据，显示前6个工具
            setTopTools(tools.slice(0, 6))
        } else {
            // 根据统计数据排序
            const sortedTools = stats
                .map(stat => tools.find(tool => tool.id === stat.id))
                .filter((tool): tool is typeof tools[0] => tool !== undefined)

            // 如果不足6个，补充其他工具
            const remaining = tools
                .filter(tool => !sortedTools.find(t => t.id === tool.id))
                .slice(0, 6 - sortedTools.length)

            setTopTools([...sortedTools, ...remaining])
        }
    }

    useEffect(() => {
        loadTopTools()
    }, [])

    const handleToolClick = (toolId: ToolType) => {
        // 发送导航事件到工具箱，并传递工具ID
        // 注意：不在这里记录使用次数，统一在ToolboxPage中记录
        window.dispatchEvent(new CustomEvent('navigate-to-tool', {
            detail: { toolId }
        }))

        // 更新显示
        setTimeout(loadTopTools, 100)
    }

    const getUsageCount = (toolId: string): number => {
        const stats = getMostUsedTools(20)
        return stats.find(s => s.id === toolId)?.count || 0
    }

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-zinc-700">常用工具</h3>
                <div className="text-xs text-zinc-500">快捷访问</div>
            </div>

            <div className="grid grid-cols-3 gap-3">
                {topTools.map((tool) => {
                    const usageCount = getUsageCount(tool.id)

                    // 缩小图标尺寸
                    const smallIcon = cloneElement(tool.icon as React.ReactElement, {
                        className: 'w-5 h-5'
                    })

                    return (
                        <Card
                            key={tool.id}
                            className="cursor-pointer transition-all hover:shadow-md hover:scale-105 hover:border-violet-300"
                            onClick={() => handleToolClick(tool.id)}
                        >
                            <CardContent className="p-4 flex flex-col items-center gap-2">
                                <div className="text-violet-600">
                                    {smallIcon}
                                </div>
                                <div className="text-xs font-medium text-center text-zinc-700">
                                    {tool.title}
                                </div>
                                {usageCount > 0 && (
                                    <div className="text-[10px] text-zinc-400">
                                        使用 {usageCount} 次
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    )
                })}
            </div>
        </div>
    )
}
