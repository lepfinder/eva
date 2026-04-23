/**
 * 自动化工具页面
 */
import { useState } from 'react'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ArrowLeft, Database } from 'lucide-react'
import { BastionLoginTool } from './automation/BastionLoginTool'

type AutomationToolType = 'list' | 'bastion-login'

interface AutomationToolConfig {
    id: AutomationToolType
    title: string
    description: string
    icon: React.ReactNode
}

const tools: AutomationToolConfig[] = [
    {
        id: 'bastion-login',
        title: '堡垒机连接串获取',
        description: '自动登录堡垒机并获取数据库连接字符串 (Playwright)',
        icon: <Database className="h-8 w-8" />
    }
]

export function AutomationPage(): React.ReactElement {
    const [currentTool, setCurrentTool] = useState<AutomationToolType>('list')

    const renderToolList = () => (
        <div className="h-full flex flex-col">
            <div className="shrink-0 pb-4">
                <h2 className="text-2xl font-bold">自动化工具</h2>
                <p className="text-muted-foreground mt-1">常用的自动化脚本与工作流</p>
            </div>

            <div className="flex-1 overflow-auto">
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {tools.map((tool) => (
                        <Card
                            key={tool.id}
                            className="cursor-pointer hover:shadow-lg transition-shadow hover:border-primary/50"
                            onClick={() => setCurrentTool(tool.id)}
                            onMouseEnter={() => {
                                if (tool.id === 'bastion-login') {
                                    window.api.automationWarmup()
                                }
                            }}
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
                            <CardTitle className="text-lg text-muted-foreground">更多脚本</CardTitle>
                            <CardDescription>待添加...</CardDescription>
                        </CardHeader>
                    </Card>
                </div>
            </div>
        </div>
    )

    const renderTool = () => {
        const tool = tools.find((t) => t.id === currentTool)
        if (!tool) return null

        return (
            <div className="h-full flex flex-col -mt-6 -mx-6">
                {/* 顶部标题栏 */}
                <div className="shrink-0 h-12 px-6 flex items-center gap-3 border-b bg-background drag-region" data-tauri-drag-region>
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
                <div className="flex-1 min-h-0 p-6 overflow-auto">
                    {currentTool === 'bastion-login' && <BastionLoginTool />}
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
