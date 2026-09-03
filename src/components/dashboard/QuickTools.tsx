import React, { useState, useEffect, cloneElement } from 'react'
import { tools, ToolType } from '@/pages/ToolboxPage'
import { getMostUsedTools } from '@/utils/toolUsage'
import { ChevronRight, Wrench } from 'lucide-react'

export function QuickTools(): React.ReactElement {
    const [topTools, setTopTools] = useState<typeof tools>([])

    const loadTopTools = () => {
        const stats = getMostUsedTools(6)
        if (stats.length === 0) {
            setTopTools(tools.slice(0, 6))
        } else {
            const sortedTools = stats
                .map(stat => tools.find(tool => tool.id === stat.id))
                .filter((tool): tool is typeof tools[0] => tool !== undefined)

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
        window.dispatchEvent(new CustomEvent('navigate-to-tool', {
            detail: { toolId }
        }))
        setTimeout(loadTopTools, 100)
    }

    const handleOpenToolbox = () => {
        window.dispatchEvent(new CustomEvent('navigate-to-page', {
            detail: { page: 'toolbox' }
        }))
    }

    return (
        <div className="space-y-2.5">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                    <Wrench className="h-3.5 w-3.5 text-emerald-500" />
                    <span>快捷直达</span>
                </div>
                <button
                    onClick={handleOpenToolbox}
                    className="flex items-center gap-0.5 text-xs text-zinc-400 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
                >
                    <span>全部工具</span>
                    <ChevronRight className="h-3 w-3" />
                </button>
            </div>

            {/* 极轻量水平胶囊流 (Dock Pills) */}
            <div className="flex flex-wrap gap-2 pt-0.5">
                {topTools.map((tool) => {
                    const smallIcon = cloneElement(tool.icon as React.ReactElement, {
                        className: 'w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0'
                    })

                    return (
                        <button
                            key={tool.id}
                            onClick={() => handleToolClick(tool.id)}
                            title={tool.id === 'local-ports' ? '本地监听端口 (应用内快捷键: ⌘P)' : tool.title}
                            className="group inline-flex items-center gap-2 h-8 px-3 rounded-full border border-white/60 dark:border-white/10 bg-white/50 dark:bg-zinc-800/40 hover:bg-emerald-50/80 dark:hover:bg-emerald-950/40 hover:border-emerald-300/80 dark:hover:border-emerald-600/50 hover:shadow-sm hover:-translate-y-0.5 transition-all duration-200"
                        >
                            {smallIcon}
                            <span className="text-xs font-medium text-zinc-700 dark:text-zinc-200 group-hover:text-emerald-700 dark:group-hover:text-emerald-300 transition-colors">
                                {tool.title}
                            </span>
                            {tool.id === 'local-ports' && (
                                <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 text-[9.5px] font-mono font-medium rounded bg-emerald-100/70 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-300/40">
                                    ⌘P
                                </kbd>
                            )}
                        </button>
                    )
                })}
            </div>
        </div>
    )
}
