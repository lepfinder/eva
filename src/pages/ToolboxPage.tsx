/**
 * 工具箱页面
 */
import { useState, useEffect } from 'react'
import { FileJson, ArrowLeft, Activity, ListFilter, GitBranch, Clock, Key, Database, Radio, SearchCode, Pipette, BookOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { JsonFormatter } from './tools/JsonFormatter'
import { MemoryAnalyzer } from './tools/MemoryAnalyzer'
import { ListDeduplicator } from './tools/ListDeduplicator'
import { SetOperations } from './tools/SetOperations'
import { TimestampConverter } from './tools/TimestampConverter'
import { PasswordGenerator } from './tools/PasswordGenerator'
import { SqlGenerator } from './tools/SqlGenerator'
import { LocalPorts } from './tools/LocalPorts'
import { EnvDetector } from './tools/EnvDetector'
import { ColorPicker } from './tools/ColorPicker'
import { CheatSheetPage } from './CheatSheetPage'
import { recordToolUsage } from '@/utils/toolUsage'

export type ToolType = 'list' | 'json-formatter' | 'memory-analyzer' | 'list-dedup' | 'set-ops' | 'timestamp' | 'password-generator' | 'sql-generator' | 'local-ports' | 'env-detector' | 'color-picker' | 'cheatsheet'

export interface ToolConfig {
    id: ToolType
    title: string
    description: string
    icon: React.ReactNode
}

export const tools: ToolConfig[] = [
    {
        id: 'json-formatter',
        title: 'JSON 格式化',
        description: '格式化、压缩和验证 JSON 数据',
        icon: <FileJson className="h-8 w-8" />
    },
    {
        id: 'memory-analyzer',
        title: '内存分析',
        description: '基于进程树聚合的智能内存分析工具，一键识别内存刺客',
        icon: <Activity className="h-8 w-8" />
    },
    {
        id: 'list-dedup',
        title: '列表去重',
        description: '快速移除文本列表中的重复项，支持排序',
        icon: <ListFilter className="h-8 w-8" />
    },
    {
        id: 'set-ops',
        title: '集合运算',
        description: '计算两个集合的交集、差集 (A-B, B-A)',
        icon: <GitBranch className="h-8 w-8" />
    },
    {
        id: 'timestamp',
        title: '时间戳转换',
        description: '时间戳与格式化时间互转，支持秒/毫秒',
        icon: <Clock className="h-8 w-8" />
    },
    {
        id: 'password-generator',
        title: '密码生成器',
        description: '生成安全复杂的随机密码',
        icon: <Key className="h-8 w-8" />
    },
    {
        id: 'sql-generator',
        title: 'SQL 生成工具',
        description: '将列表数据转换为 SELECT/DELETE/UPDATE 语句',
        icon: <Database className="h-8 w-8" />
    },
    {
        id: 'local-ports',
        title: '本地监听端口',
        description: '查看和管理本地监听的网络端口',
        icon: <Radio className="h-8 w-8" />
    },
    {
        id: 'color-picker',
        title: '拾色器',
        description: '颜色选择与 Hex/RGB 代码转换工具',
        icon: <Pipette className="h-8 w-8" />
    },
    {
        id: 'env-detector',
        title: '环境探测',
        description: '自动识别本机开发环境，包括工具版本与路径',
        icon: <SearchCode className="h-8 w-8" />
    },
    {
        id: 'cheatsheet',
        title: '速查表',
        description: '常用软件命令与操作速查索引',
        icon: <BookOpen className="h-8 w-8" />
    }
]

// 工具标题映射
const TOOL_TITLE_MAP: Record<ToolType, string> = {
    'list': '',
    'json-formatter': 'JSON 格式化',
    'memory-analyzer': '内存分析',
    'list-dedup': '列表去重',
    'set-ops': '集合运算',
    'timestamp': '时间戳转换',
    'password-generator': '密码生成器',
    'sql-generator': 'SQL 生成工具',
    'local-ports': '本地监听端口',
    'env-detector': '环境探测',
    'color-picker': '拾色器',
    'cheatsheet': '速查表'
}

interface ToolboxPageProps {
    onSubTitleChange?: (title: string | null) => void
}

export function ToolboxPage({ onSubTitleChange }: ToolboxPageProps): React.ReactElement {
    const [currentTool, setCurrentTool] = useState<ToolType>('list')

    // 当工具切换时更新子标题
    useEffect(() => {
        if (onSubTitleChange) {
            const toolTitle = TOOL_TITLE_MAP[currentTool]
            onSubTitleChange(toolTitle || null)
        }
    }, [currentTool, onSubTitleChange])

    // 监听工具打开事件（来自QuickTools）
    useEffect(() => {
        const handleOpenTool = (e: Event) => {
            const customEvent = e as CustomEvent<{ toolId: ToolType }>
            const toolId = customEvent.detail?.toolId

            if (toolId && toolId !== 'list') {
                handleToolClick(toolId)
            }
        }

        window.addEventListener('open-tool', handleOpenTool)
        return () => window.removeEventListener('open-tool', handleOpenTool)
    }, [])

    // 处理工具点击，记录使用统计
    const handleToolClick = (toolId: ToolType) => {
        if (toolId !== 'list') {
            recordToolUsage(toolId)
        }
        setCurrentTool(toolId)
    }

    // 渲染工具列表
    const renderToolList = () => (
        <div className="h-full flex flex-col">
            <div className="shrink-0 pb-4">
                <h2 className="text-2xl font-bold">工具箱</h2>
                <p className="text-muted-foreground mt-1">常用开发工具集合</p>
            </div>

            <div className="flex-1 overflow-auto">
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {tools.map((tool) => (
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

                    {/* 更多工具占位 */}
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

    // 渲染工具页面
    const renderTool = () => {
        const tool = tools.find((t) => t.id === currentTool)
        if (!tool) return null

        return (
            <div className="h-full flex flex-col -mt-6 -mx-6">
                {/* 顶部标题栏 - 与窗口顶部对齐 */}
                <div className="sh rink-0 h-12 px-6 flex items-center gap-3 border-b bg-background drag-region" data-tauri-drag-region>
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

                {/* 工具内容 */}
                <div className="flex-1 min-h-0 p-6">
                    {currentTool === 'json-formatter' && <JsonFormatter />}
                    {currentTool === 'memory-analyzer' && <MemoryAnalyzer />}
                    {currentTool === 'list-dedup' && <ListDeduplicator />}
                    {currentTool === 'set-ops' && <SetOperations />}
                    {currentTool === 'timestamp' && <TimestampConverter />}
                    {currentTool === 'password-generator' && <PasswordGenerator />}
                    {currentTool === 'sql-generator' && <SqlGenerator />}
                    {currentTool === 'local-ports' && <LocalPorts />}
                    {currentTool === 'env-detector' && <EnvDetector />}
                    {currentTool === 'color-picker' && <ColorPicker />}
                    {currentTool === 'cheatsheet' && <CheatSheetPage />}
                </div>
            </div>
        )
    }

    return (
        <div className="h-full">
            {currentTool === 'list' ? renderToolList() : renderTool()}
        </div>
    )
}
