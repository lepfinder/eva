import React from 'react'
import { Download, Mic, Globe, Sparkles, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { DownloadableModel } from '../types'

interface AddModelDialogProps {
    downloadableModels: DownloadableModel[]
    downloadingModels: Record<string, { progress: number; status: string }>
    onDownload: (modelId: string) => void
    onClose: () => void
}

// 可下载模型卡片（复用组件）
function DownloadableModelCard({
    model,
    downloadingModels,
    onDownload
}: {
    model: DownloadableModel
    downloadingModels: Record<string, { progress: number; status: string }>
    onDownload: (id: string) => void
}) {
    return (
        <div className={cn(
            "p-4 rounded-lg border transition-all",
            model.downloaded
                ? "bg-green-50 border-green-200"
                : "bg-zinc-50 border-zinc-200 hover:border-violet-300"
        )}>
            <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-zinc-900">{model.name}</p>
                    <p className="text-xs text-zinc-500 mt-1">{model.description}</p>
                    <p className="text-xs text-zinc-400 mt-1">{model.size}</p>
                </div>
                {model.downloaded ? (
                    <span className="px-2 py-1 text-xs font-medium bg-green-100 text-green-700 rounded">已下载</span>
                ) : downloadingModels[model.id] ? (
                    <div className="text-right">
                        <span className="text-xs text-violet-600">{downloadingModels[model.id].progress}%</span>
                        <div className="w-16 h-1.5 bg-zinc-200 rounded-full mt-1 overflow-hidden">
                            <div
                                className="h-full bg-violet-600 transition-all"
                                style={{ width: `${downloadingModels[model.id].progress}%` }}
                            />
                        </div>
                    </div>
                ) : (
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onDownload(model.id)}
                        className="gap-1"
                    >
                        <Download className="h-3 w-3" />
                        下载
                    </Button>
                )}
            </div>
        </div>
    )
}

export function AddModelDialog({ downloadableModels, downloadingModels, onDownload, onClose }: AddModelDialogProps) {
    const modelGroups = [
        {
            type: 'whisper',
            label: '语音识别模型',
            icon: <Mic className="h-4 w-4 text-violet-600" />
        },
        {
            type: 'embedding',
            label: '文本嵌入模型',
            icon: <Sparkles className="h-4 w-4 text-violet-600" />
        },
        {
            type: 'reranker',
            label: '重排序模型',
            icon: <Search className="h-4 w-4 text-violet-600" />
        },
        {
            type: 'translation',
            label: '机器翻译模型',
            icon: <Globe className="h-4 w-4 text-violet-600" />
        }
    ]

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
            <div className="bg-white rounded-xl shadow-xl w-[700px] max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="p-6 border-b border-zinc-200">
                    <h3 className="text-lg font-semibold text-zinc-900">添加模型</h3>
                    <p className="text-sm text-zinc-500 mt-1">从 HuggingFace 下载模型到本地仓库</p>
                </div>
                <div className="flex-1 overflow-auto p-6">
                    <div className="space-y-4">
                        {modelGroups.map(group => {
                            const models = downloadableModels.filter(m => m.type === group.type)
                            if (models.length === 0) return null
                            return (
                                <div key={group.type}>
                                    <h4 className="text-sm font-medium text-zinc-700 mb-3 flex items-center gap-2">
                                        {group.icon}
                                        {group.label}
                                    </h4>
                                    <div className="grid grid-cols-2 gap-3">
                                        {models.map(model => (
                                            <DownloadableModelCard
                                                key={model.id}
                                                model={model}
                                                downloadingModels={downloadingModels}
                                                onDownload={onDownload}
                                            />
                                        ))}
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                </div>
                <div className="p-4 border-t border-zinc-200 flex justify-end">
                    <Button variant="outline" onClick={onClose}>关闭</Button>
                </div>
            </div>
        </div>
    )
}
