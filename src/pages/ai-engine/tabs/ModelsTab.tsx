import React from 'react'
import {
    Database, HardDrive, FolderOpen, RefreshCcw, Plus, Trash2, Cpu, Mic, Globe, Sparkles, FileText
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { TabsContent } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import type { LocalModel, AIEngineConfig } from '../types'

interface ModelsTabProps {
    localModels: LocalModel[]
    totalModelSize: number
    isLoadingModels: boolean
    aiEngineConfig: AIEngineConfig | null
    onAddModel: () => void
    onRefresh: () => void
    formatBytes: (bytes: number) => string
    getModelTypeLabel: (type: LocalModel['type']) => { label: string; color: string }
}

function ModelCard({ model, getModelTypeLabel }: { model: LocalModel; getModelTypeLabel: ModelsTabProps['getModelTypeLabel'] }) {
    const { label, color } = getModelTypeLabel(model.type)
    const iconMap: Record<LocalModel['type'], React.ReactNode> = {
        embedding: <Cpu className="h-5 w-5 text-violet-600" />,
        reranker: <Cpu className="h-5 w-5 text-indigo-600" />,
        whisper: <Mic className="h-5 w-5 text-orange-600" />,
        translation: <Globe className="h-5 w-5 text-blue-600" />,
        llm: <Sparkles className="h-5 w-5 text-emerald-600" />,
        other: <FileText className="h-5 w-5 text-zinc-600" />
    }
    return (
        <div className="relative overflow-hidden rounded-lg bg-zinc-50 border border-zinc-200 p-4">
            <div className="absolute inset-0 bg-gradient-to-r from-violet-100/50 to-transparent" style={{ width: '100%' }} />
            <div className="relative flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-white border border-zinc-200 flex items-center justify-center shadow-sm">
                        {iconMap[model.type]}
                    </div>
                    <div>
                        <p className="text-sm font-medium text-zinc-900">{model.name}</p>
                        <div className="flex items-center gap-2 mt-1">
                            <span className="text-xs text-zinc-500">{model.size}</span>
                            <span className="text-xs text-zinc-400">•</span>
                            <span className="text-xs text-zinc-500">{model.files} 文件</span>
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <span className={cn("px-2 py-0.5 text-xs font-medium rounded-full border", color)}>{label}</span>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-zinc-400 hover:text-red-600 hover:bg-red-50">
                        <Trash2 className="h-4 w-4" />
                    </Button>
                </div>
            </div>
        </div>
    )
}

export function ModelsTab({
    localModels,
    totalModelSize,
    isLoadingModels,
    aiEngineConfig,
    onAddModel,
    onRefresh,
    formatBytes,
    getModelTypeLabel
}: ModelsTabProps) {
    const modelPath = aiEngineConfig?.installPath ? `${aiEngineConfig.installPath}/models` : './ai_engine/models'

    const modelCategories = [
        { type: 'embedding' as const, label: 'Embedding 模型', desc: '用于文本向量化和语义检索', icon: <Sparkles className="h-4 w-4 text-violet-600" /> },
        { type: 'reranker' as const, label: 'Reranker 模型', desc: '用于检索结果重排序优化', icon: <FileText className="h-4 w-4 text-indigo-600" /> }
    ]

    const conditionalCategories = [
        { type: 'whisper' as const, label: 'Whisper 模型', desc: '用于语音识别和转写', icon: <Mic className="h-4 w-4 text-orange-600" /> },
        { type: 'translation' as const, label: 'Translation 模型', desc: '用于多语言翻译', icon: <Globe className="h-4 w-4 text-blue-600" /> }
    ]

    return (
        <TabsContent value="models" className="flex-1 overflow-auto mt-0 scrollbar-thin">
            <div className="px-6 pb-6 space-y-5 animation-fade-in">
                {/* 统计卡片 */}
                <div className="grid grid-cols-2 gap-4">
                    <Card className="bg-white border-zinc-200 shadow-sm">
                        <CardContent className="p-4">
                            <div className="flex items-center gap-3">
                                <div className="h-10 w-10 rounded-lg bg-violet-100 flex items-center justify-center">
                                    <Database className="h-5 w-5 text-violet-600" />
                                </div>
                                <div className="min-w-0">
                                    <p className="text-2xl font-semibold text-zinc-900">{localModels.length}</p>
                                    <p className="text-xs text-zinc-500 whitespace-nowrap">本地模型</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                    <Card className="bg-white border-zinc-200 shadow-sm">
                        <CardContent className="p-4">
                            <div className="flex items-center gap-3">
                                <div className="h-10 w-10 rounded-lg bg-indigo-100 flex items-center justify-center">
                                    <HardDrive className="h-5 w-5 text-indigo-600" />
                                </div>
                                <div className="min-w-0">
                                    <p className="text-2xl font-semibold text-zinc-900">{formatBytes(totalModelSize)}</p>
                                    <p className="text-xs text-zinc-500 whitespace-nowrap">磁盘占用</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* 操作栏 */}
                <Card className="bg-white border-zinc-200 shadow-sm min-w-0">
                    <CardContent className="p-4 flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                            <div className="h-10 w-10 rounded-lg bg-zinc-100 flex items-center justify-center shrink-0">
                                <FolderOpen className="h-5 w-5 text-zinc-600" />
                            </div>
                            <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium text-zinc-900">模型目录</p>
                                <p className="text-xs text-zinc-500 font-mono truncate" title={modelPath}>{modelPath}</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <Button variant="default" size="sm" onClick={onAddModel} className="gap-2 bg-violet-600 hover:bg-violet-700 text-white shrink-0">
                                <Plus className="h-3.5 w-3.5" />
                                添加模型
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => { const path = modelPath; window.api.shell.openPath(path) }} className="gap-2 border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-600 shrink-0">
                                <FolderOpen className="h-3.5 w-3.5" />
                                打开
                            </Button>
                            <Button variant="outline" size="sm" onClick={onRefresh} disabled={isLoadingModels} className="gap-2 border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-600 shrink-0">
                                <RefreshCcw className={cn("h-3.5 w-3.5", isLoadingModels && "animate-spin")} />
                                刷新
                            </Button>
                        </div>
                    </CardContent>
                </Card>

                {/* 常驻模型分类（两列） */}
                <div className="grid grid-cols-2 gap-5">
                    {modelCategories.map(cat => (
                        <Card key={cat.type} className="bg-white border-zinc-200 shadow-sm">
                            <CardHeader>
                                <CardTitle className="text-sm font-medium text-zinc-900 flex items-center gap-2">
                                    {cat.icon}
                                    {cat.label}
                                </CardTitle>
                                <CardDescription className="text-xs text-zinc-500">{cat.desc}</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                {localModels.filter(m => m.type === cat.type).map(model => (
                                    <ModelCard key={model.name} model={model} getModelTypeLabel={getModelTypeLabel} />
                                ))}
                                {localModels.filter(m => m.type === cat.type).length === 0 && (
                                    <div className="text-center py-8 text-zinc-400">
                                        <Database className="h-8 w-8 mx-auto mb-2 opacity-50" />
                                        <p className="text-sm">暂无 {cat.label}</p>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    ))}
                </div>

                {/* 条件显示的模型分类 */}
                {conditionalCategories.map(cat => {
                    const catModels = localModels.filter(m => m.type === cat.type)
                    if (catModels.length === 0) return null
                    return (
                        <Card key={cat.type} className="bg-white border-zinc-200 shadow-sm">
                            <CardHeader>
                                <CardTitle className="text-sm font-medium text-zinc-900 flex items-center gap-2">
                                    {cat.icon}
                                    {cat.label}
                                </CardTitle>
                                <CardDescription className="text-xs text-zinc-500">{cat.desc}</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="grid grid-cols-2 gap-3">
                                    {catModels.map(model => (
                                        <ModelCard key={model.name} model={model} getModelTypeLabel={getModelTypeLabel} />
                                    ))}
                                </div>
                            </CardContent>
                        </Card>
                    )
                })}

                {/* 清理操作 */}
                <Card className="bg-white border-zinc-200 shadow-sm">
                    <CardContent className="p-4 flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-zinc-900">清理模型缓存</p>
                            <p className="text-xs text-zinc-500 mt-0.5">删除所有本地缓存的模型文件，释放 {formatBytes(totalModelSize)} 磁盘空间</p>
                        </div>
                        <Button variant="outline" size="sm" className="gap-2 border-red-200 text-red-600 hover:bg-red-50 hover:border-red-300">
                            <Trash2 className="h-4 w-4" />
                            清理全部
                        </Button>
                    </CardContent>
                </Card>
            </div>
        </TabsContent>
    )
}
