import React, { useState, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { getActiveAiConfig } from '@/components/AiProviderSettings'
import {
    Sparkles,
    Trash2,
    Check,
    RefreshCw,
    FolderKanban,
    Tag,
    AlertCircle,
    Code2,
    Terminal,
    BookOpen,
    MessageSquare,
    PenLine,
    Palette,
    Gamepad2,
    Zap,
    Globe,
    Minus,
    Pause,
    Pin
} from 'lucide-react'

// 可供用户选择的分类定义
export const CATEGORY_OPTIONS = [
    { id: 'development',   name: '开发', icon: Code2,         color: '#8b5cf6' },
    { id: 'operations',    name: '运维', icon: Terminal,      color: '#ea580c' },
    { id: 'productivity',  name: '效率', icon: Zap,           color: '#6366f1' },
    { id: 'communication', name: '沟通', icon: MessageSquare, color: '#10b981' },
    { id: 'writing',       name: '写作', icon: PenLine,       color: '#ec4899' },
    { id: 'browsing',      name: '浏览', icon: Globe,         color: '#06b6d4' },
    { id: 'research',      name: '调研', icon: BookOpen,      color: '#3b82f6' },
    { id: 'design',        name: '设计', icon: Palette,       color: '#f43f5e' },
    { id: 'entertainment', name: '娱乐', icon: Gamepad2,      color: '#f59e0b' },
    { id: 'system',        name: '系统', icon: Pause,         color: '#9ca3af' },
    { id: 'distracted',    name: '走神', icon: Minus,         color: '#64748b' },
    { id: 'other',         name: '其他', icon: Pin,           color: '#94a3b8' },
]

export interface UnclassifiedAppSummary {
    appName: string
    totalDuration: number
    count: number
    sampleTitle?: string
}

export interface UserAppRule {
    appName: string
    category: string
    updatedAt: number
}

function formatDuration(seconds: number): string {
    if (seconds < 60) return `${seconds}秒`
    if (seconds < 3600) return `${Math.floor(seconds / 60)}分钟`
    const hours = Math.floor(seconds / 3600)
    const mins = Math.floor((seconds % 3600) / 60)
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
}

interface AppCategoryManagerModalProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    onApplied?: () => void
}

export function AppCategoryManagerModal({
    open,
    onOpenChange,
    onApplied
}: AppCategoryManagerModalProps) {
    const [activeTab, setActiveTab] = useState<'unclassified' | 'rules'>('unclassified')
    const [unclassified, setUnclassified] = useState<UnclassifiedAppSummary[]>([])
    const [rules, setRules] = useState<UserAppRule[]>([])
    const [loading, setLoading] = useState(false)
    const [aiPredicting, setAiPredicting] = useState(false)
    const [applying, setApplying] = useState(false)
    const [selectedMap, setSelectedMap] = useState<Record<string, string>>({})
    const [aiSuggested, setAiSuggested] = useState<Record<string, boolean>>({})

    // 加载未分类应用
    const loadUnclassified = useCallback(async () => {
        try {
            setLoading(true)
            const list = await invoke<UnclassifiedAppSummary[]>('activity_get_unclassified_apps', { limit: 60 })
            setUnclassified(list)
            // 初始化选中的值
            const initialMap: Record<string, string> = {}
            for (const item of list) {
                if (!initialMap[item.appName]) {
                    initialMap[item.appName] = 'development' // 默认选项预置为常用类别
                }
            }
            setSelectedMap(prev => ({ ...initialMap, ...prev }))
        } catch (e) {
            console.error('Failed to load unclassified apps:', e)
        } finally {
            setLoading(false)
        }
    }, [])

    // 加载已有自定义规则
    const loadRules = useCallback(async () => {
        try {
            const list = await invoke<UserAppRule[]>('activity_get_custom_rules')
            setRules(list)
        } catch (e) {
            console.error('Failed to load custom rules:', e)
        }
    }, [])

    useEffect(() => {
        if (open) {
            loadUnclassified()
            loadRules()
        }
    }, [open, loadUnclassified, loadRules])

    // AI 智能建议
    const handleAiSuggest = async () => {
        if (unclassified.length === 0) return
        const aiCfg = getActiveAiConfig()
        if (!aiCfg) {
            alert('请先在「设置 → AI 供应商」配置 API Key 即可开启 AI 智能预测！')
            return
        }

        try {
            setAiPredicting(true)
            const targetItems = unclassified.slice(0, 30) // 一次最多 30 个
            const lines = targetItems.map((item, idx) => 
                `${idx + 1}. App: "${item.appName}", 参考标题: "${item.sampleTitle || '无'}"`
            ).join('\n')

            const prompt = `你是一个专业的计算机生产力与应用行为分析助手。请分析以下用户的 macOS 应用列表，为每个应用推荐最合适的分类。
可选分类代码（必须严格使用以下之一）：
- development (研发、代码编辑器、数据库、接口调试、本地项目)
- operations (终端、命令行、远程桌面、容器、运维网络)
- productivity (效率工具、AI对话应用、表格演示、日历待办)
- communication (微信、飞书、钉钉、邮件、会议等社交沟通)
- writing (文档撰写、笔记、知识库、Word、WPS、Markdown)
- browsing (网页浏览器)
- research (学术文献、调研学习、电子书阅读)
- design (设计软件、原型图、思维导图)
- entertainment (音乐播放器、视频、游戏)
- system (系统偏好设置、访达、活动监视器)

输入列表：
${lines}

请仅返回标准 JSON 数组，格式如下（不要包含任何多余解说）：
[
  {"app": "应用名", "category": "development"}
]`

            const data = await window.api.ai.chatCompletion({
                baseUrl: aiCfg.config.baseUrl,
                apiKey: aiCfg.config.apiKey,
                model: aiCfg.config.model,
                messages: [{ role: 'user', content: prompt }],
                maxTokens: 1500,
                temperature: 0.1,
            })

            const text = data.choices?.[0]?.message?.content || ''
            const match = text.match(/\[[\s\S]*\]/)
            if (match) {
                const parsed = JSON.parse(match[0]) as Array<{ app: string; category: string }>
                const newMap = { ...selectedMap }
                const suggestedMap: Record<string, boolean> = { ...aiSuggested }
                for (const item of parsed) {
                    if (item.app && item.category) {
                        newMap[item.app] = item.category
                        suggestedMap[item.app] = true
                    }
                }
                setSelectedMap(newMap)
                setAiSuggested(suggestedMap)
            }
        } catch (err: any) {
            console.error('AI suggestion failed:', err)
            alert(`AI 预测失败: ${err?.message || err}`)
        } finally {
            setAiPredicting(false)
        }
    }

    // 单个保存
    const handleSaveSingle = async (appName: string, category: string) => {
        try {
            await invoke('activity_set_custom_rule', { appName, category })
            setUnclassified(prev => prev.filter(x => x.appName !== appName))
            loadRules()
            onApplied?.()
        } catch (e) {
            console.error('Failed to set rule:', e)
        }
    }

    // 批量全部保存并应用
    const handleBatchSave = async () => {
        if (unclassified.length === 0) return
        try {
            setApplying(true)
            const rulesToSave = unclassified.map(item => ({
                appName: item.appName,
                category: selectedMap[item.appName] || 'development'
            }))
            await invoke('activity_batch_set_custom_rules', { rules: rulesToSave })
            setUnclassified([])
            await loadRules()
            onApplied?.()
            setActiveTab('rules')
        } catch (e: any) {
            console.error('Failed to batch save:', e)
            alert(`保存失败: ${e?.message || e}`)
        } finally {
            setApplying(false)
        }
    }

    // 删除已有规则
    const handleDeleteRule = async (appName: string) => {
        try {
            await invoke('activity_delete_custom_rule', { appName })
            setRules(prev => prev.filter(r => r.appName !== appName))
            loadUnclassified()
            onApplied?.()
        } catch (e) {
            console.error('Failed to delete rule:', e)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col p-6">
                <DialogHeader className="pb-2">
                    <DialogTitle className="text-lg font-bold flex items-center gap-2">
                        <FolderKanban className="h-5 w-5 text-violet-500" />
                        应用分类管理与学习
                    </DialogTitle>
                    <DialogDescription className="text-xs text-zinc-500">
                        为未分类的个性化应用定义专属类别。确认后将立即写入持久化规则，并自动回溯全量历史数据。
                    </DialogDescription>
                </DialogHeader>

                <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="flex-1 flex flex-col min-h-0">
                    <div className="flex items-center justify-between border-b pb-2 mb-3">
                        <TabsList className="grid grid-cols-2 w-64 h-8">
                            <TabsTrigger value="unclassified" className="text-xs gap-1.5">
                                待标注应用
                                {unclassified.length > 0 && (
                                    <Badge variant="secondary" className="px-1.5 py-0 text-[10px] bg-amber-500/15 text-amber-600 dark:text-amber-400">
                                        {unclassified.length}
                                    </Badge>
                                )}
                            </TabsTrigger>
                            <TabsTrigger value="rules" className="text-xs gap-1.5">
                                已生效规则
                                <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                                    {rules.length}
                                </Badge>
                            </TabsTrigger>
                        </TabsList>

                        {activeTab === 'unclassified' && unclassified.length > 0 && (
                            <div className="flex items-center gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 text-xs gap-1.5 border-violet-200 dark:border-violet-800 text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-950/30"
                                    onClick={handleAiSuggest}
                                    disabled={aiPredicting}
                                >
                                    {aiPredicting ? (
                                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                        <Sparkles className="h-3.5 w-3.5" />
                                    )}
                                    AI 智能预测建议
                                </Button>
                                <Button
                                    size="sm"
                                    className="h-8 text-xs bg-violet-600 hover:bg-violet-700 text-white gap-1.5"
                                    onClick={handleBatchSave}
                                    disabled={applying}
                                >
                                    {applying ? (
                                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                        <Check className="h-3.5 w-3.5" />
                                    )}
                                    全部保存并生效
                                </Button>
                            </div>
                        )}
                    </div>

                    {/* Tab 1: 待标注应用 */}
                    <TabsContent value="unclassified" className="flex-1 overflow-y-auto pr-1 space-y-2.5 mt-0 min-h-[300px]">
                        {loading ? (
                            <div className="flex flex-col items-center justify-center h-48 text-zinc-400 gap-2">
                                <RefreshCw className="h-6 w-6 animate-spin" />
                                <span className="text-xs">正在扫描未分类活动应用...</span>
                            </div>
                        ) : unclassified.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-48 text-center text-zinc-400">
                                <Check className="h-10 w-10 text-emerald-500/80 mb-2" />
                                <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">太棒了！暂无未分类应用</p>
                                <p className="text-xs text-zinc-400 mt-1">您常用的软件均已归类至对应标签，历史统计准确无误。</p>
                            </div>
                        ) : (
                            unclassified.map(item => {
                                const currentCat = selectedMap[item.appName] || 'development'
                                const isAiRec = aiSuggested[item.appName]
                                const activeCatConfig = CATEGORY_OPTIONS.find(c => c.id === currentCat) || CATEGORY_OPTIONS[0]

                                return (
                                    <div
                                        key={item.appName}
                                        className="flex items-center justify-between p-3 rounded-lg border bg-zinc-50/50 dark:bg-zinc-900/50 hover:bg-zinc-100/60 dark:hover:bg-zinc-800/40 transition-colors gap-3"
                                    >
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className="font-semibold text-sm text-zinc-800 dark:text-zinc-200 truncate">
                                                    {item.appName}
                                                </span>
                                                <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal">
                                                    {formatDuration(item.totalDuration)}
                                                </Badge>
                                                {isAiRec && (
                                                    <span className="flex items-center gap-1 text-[10px] text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-950/50 px-1.5 py-0.5 rounded">
                                                        <Sparkles className="h-2.5 w-2.5" />
                                                        AI 建议
                                                    </span>
                                                )}
                                            </div>
                                            {item.sampleTitle && (
                                                <p className="text-xs text-zinc-400 truncate mt-0.5" title={item.sampleTitle}>
                                                    参考窗口：{item.sampleTitle}
                                                </p>
                                            )}
                                        </div>

                                        <div className="flex items-center gap-2 shrink-0">
                                            <select
                                                value={currentCat}
                                                onChange={(e) => {
                                                    const val = e.target.value
                                                    setSelectedMap(prev => ({ ...prev, [item.appName]: val }))
                                                }}
                                                className="text-xs h-8 px-2.5 py-1 rounded-md border bg-white dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-violet-500"
                                                style={{ borderColor: activeCatConfig.color + '60' }}
                                            >
                                                {CATEGORY_OPTIONS.map(opt => (
                                                    <option key={opt.id} value={opt.id}>
                                                        {opt.name}
                                                    </option>
                                                ))}
                                            </select>

                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-8 w-8 p-0 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
                                                onClick={() => handleSaveSingle(item.appName, currentCat)}
                                                title="立即生效并更新历史"
                                            >
                                                <Check className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </div>
                                )
                            })
                        )}
                    </TabsContent>

                    {/* Tab 2: 已生效规则 */}
                    <TabsContent value="rules" className="flex-1 overflow-y-auto pr-1 space-y-2 mt-0 min-h-[300px]">
                        {rules.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-48 text-center text-zinc-400">
                                <Tag className="h-8 w-8 text-zinc-300 dark:text-zinc-600 mb-2" />
                                <p className="text-xs">暂无自定义规则</p>
                                <p className="text-[10px] text-zinc-400 mt-0.5">当您在「待标注」中确认应用后，规则将在此处沉淀展示。</p>
                            </div>
                        ) : (
                            rules.map(rule => {
                                const catConfig = CATEGORY_OPTIONS.find(c => c.id === rule.category) || CATEGORY_OPTIONS[0]
                                const IconComp = catConfig.icon

                                return (
                                    <div
                                        key={rule.appName}
                                        className="flex items-center justify-between p-2.5 rounded-lg border bg-zinc-50/50 dark:bg-zinc-900/50 hover:bg-zinc-100/50 transition-colors"
                                    >
                                        <div className="flex items-center gap-2 min-w-0">
                                            <span
                                                className="w-6 h-6 rounded flex items-center justify-center shrink-0"
                                                style={{ backgroundColor: catConfig.color + '20', color: catConfig.color }}
                                            >
                                                <IconComp className="h-3.5 w-3.5" />
                                            </span>
                                            <span className="font-medium text-xs text-zinc-800 dark:text-zinc-200 truncate">
                                                {rule.appName}
                                            </span>
                                        </div>

                                        <div className="flex items-center gap-2 shrink-0">
                                            <Badge
                                                variant="outline"
                                                className="text-[10px] font-medium"
                                                style={{
                                                    backgroundColor: catConfig.color + '15',
                                                    color: catConfig.color,
                                                    borderColor: catConfig.color + '40'
                                                }}
                                            >
                                                {catConfig.name}
                                            </Badge>

                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-7 w-7 p-0 text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20"
                                                onClick={() => handleDeleteRule(rule.appName)}
                                                title="删除该自定义规则并恢复默认"
                                            >
                                                <Trash2 className="h-3.5 w-3.5" />
                                            </Button>
                                        </div>
                                    </div>
                                )
                            })
                        )}
                    </TabsContent>
                </Tabs>
            </DialogContent>
        </Dialog>
    )
}
