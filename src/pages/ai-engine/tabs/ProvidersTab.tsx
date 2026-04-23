import React from 'react'
import {
    Layers, Plus, Settings2, Wifi, Loader2, CheckCircle, XCircle, Circle,
    Trash2, Eye, EyeOff, ExternalLink, Zap, Box, Sparkles, AlertCircle
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { TabsContent } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import type { AIProvider } from '../types'

interface ProvidersTabProps {
    providers: AIProvider[]
    selectedProviderId: string
    selectedProvider: AIProvider | undefined
    editingModelsFor: string | null
    newModelInput: string
    showApiKeys: Record<string, boolean>
    onSelectProvider: (id: string) => void
    onUpdateBaseUrl: (id: string, url: string) => void
    onUpdateApiKey: (id: string, key: string) => void
    onUpdateModels: (id: string, models: string[]) => void
    onTestConnection: (id: string) => void
    onDeleteProvider: (id: string) => void
    onSetShowApiKeys: React.Dispatch<React.SetStateAction<Record<string, boolean>>>
    onSetEditingModelsFor: (id: string | null) => void
    onSetNewModelInput: (v: string) => void
    onAddCustomProvider: () => void
    onShowSystemModelSettings: () => void
}

export function ProvidersTab({
    providers,
    selectedProviderId,
    selectedProvider,
    editingModelsFor,
    newModelInput,
    showApiKeys,
    onSelectProvider,
    onUpdateBaseUrl,
    onUpdateApiKey,
    onUpdateModels,
    onTestConnection,
    onDeleteProvider,
    onSetShowApiKeys,
    onSetEditingModelsFor,
    onSetNewModelInput,
    onAddCustomProvider,
    onShowSystemModelSettings
}: ProvidersTabProps) {
    return (
        <TabsContent value="providers" className="flex-1 overflow-hidden mt-0">
            <div className="flex h-full animation-fade-in">
                {/* 左侧供应商列表 */}
                <div className="w-72 border-r border-zinc-200 bg-zinc-50/50 flex flex-col">
                    <div className="p-4 border-b border-zinc-200 bg-white flex items-center justify-between shrink-0">
                        <h2 className="text-sm font-semibold text-zinc-900 flex items-center gap-2">
                            <Layers className="h-4 w-4 text-violet-500" />
                            供应商列表
                        </h2>
                        <Button
                            variant="ghost" size="icon"
                            onClick={onAddCustomProvider}
                            className="h-7 w-7 text-zinc-500 hover:text-violet-600 hover:bg-violet-50"
                            title="添加自定义供应商"
                        >
                            <Plus className="h-4 w-4" />
                        </Button>
                    </div>
                    <div className="flex-1 overflow-auto p-2 space-y-1 scrollbar-thin">
                        {providers.map((p) => (
                            <button
                                key={p.id}
                                onClick={() => onSelectProvider(p.id)}
                                className={cn(
                                    "w-full flex items-center gap-3 p-3 rounded-lg transition-all text-left group",
                                    selectedProviderId === p.id
                                        ? "bg-white shadow-sm border border-zinc-200 text-violet-600"
                                        : "hover:bg-white/60 text-zinc-600 border border-transparent"
                                )}
                            >
                                <div className={cn(
                                    "h-9 w-9 rounded-lg flex items-center justify-center shrink-0 transition-colors",
                                    selectedProviderId === p.id ? "bg-violet-50" : "bg-zinc-100 group-hover:bg-zinc-200"
                                )}>
                                    {p.icon}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="text-sm font-medium truncate">{p.name}</span>
                                        <div className={cn(
                                            "h-2 w-2 rounded-full shrink-0",
                                            p.status === 'connected' ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-zinc-300"
                                        )} />
                                    </div>
                                    <div className="flex items-center gap-1.5 mt-0.5">
                                        <span className="text-[10px] text-zinc-400 truncate">
                                            {p.isLocal ? '本地服务' : p.baseUrl.replace(/^https?:\/\//, '')}
                                        </span>
                                    </div>
                                </div>
                            </button>
                        ))}
                    </div>
                    <div className="p-4 border-t border-zinc-200 bg-white/50 shrink-0">
                        <Button
                            variant="outline" size="sm"
                            onClick={onShowSystemModelSettings}
                            className="w-full gap-2 border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100 hover:border-violet-300 shadow-sm"
                        >
                            <Settings2 className="h-4 w-4" />
                            系统模型设置
                        </Button>
                    </div>
                </div>

                {/* 右侧配置详情 */}
                <div className="flex-1 overflow-auto bg-white scrollbar-thin">
                    {selectedProvider ? (
                        <div className="p-8 max-w-4xl mx-auto space-y-8">
                            {/* 头部信息 */}
                            <div className="flex items-start justify-between">
                                <div className="flex items-center gap-5">
                                    <div className="h-16 w-16 rounded-2xl bg-zinc-50 border border-zinc-200 flex items-center justify-center shadow-sm">
                                        {selectedProvider.icon}
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-3">
                                            <h1 className="text-2xl font-bold text-zinc-900">{selectedProvider.name}</h1>
                                            {selectedProvider.isLocal && (
                                                <span className="px-2 py-0.5 text-xs font-medium bg-emerald-100 text-emerald-700 rounded-full">本地服务</span>
                                            )}
                                            {selectedProvider.isCustom && (
                                                <span className="px-2 py-0.5 text-xs font-medium bg-indigo-100 text-indigo-700 rounded-full">自定义</span>
                                            )}
                                        </div>
                                        <p className="text-zinc-500 mt-1 flex items-center gap-2">
                                            {selectedProvider.status === 'connected' ? (
                                                <><CheckCircle className="h-4 w-4 text-emerald-500" /> <span className="text-emerald-700">服务已连接</span></>
                                            ) : selectedProvider.status === 'testing' ? (
                                                <><Loader2 className="h-4 w-4 animate-spin text-amber-500" /> <span className="text-amber-700">正在测试连接...</span></>
                                            ) : selectedProvider.status === 'error' ? (
                                                <><XCircle className="h-4 w-4 text-red-500" /> <span className="text-red-700">连接失败</span></>
                                            ) : (
                                                <><Circle className="h-4 w-4 text-zinc-300" /> <span>尚未配置</span></>
                                            )}
                                        </p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3">
                                    {selectedProvider.isCustom && (
                                        <Button
                                            variant="ghost" size="sm"
                                            onClick={() => onDeleteProvider(selectedProvider.id)}
                                            className="text-red-500 hover:text-red-700 hover:bg-red-50"
                                        >
                                            <Trash2 className="h-4 w-4 mr-2" />
                                            删除供应商
                                        </Button>
                                    )}
                                    <Button
                                        onClick={() => onTestConnection(selectedProvider.id)}
                                        disabled={(!selectedProvider.isLocal && !selectedProvider.apiKey) || selectedProvider.status === 'testing'}
                                        className="gap-2 bg-violet-600 hover:bg-violet-700 text-white shadow-md shadow-violet-200"
                                    >
                                        {selectedProvider.status === 'testing' ? (
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : (
                                            <Wifi className="h-4 w-4" />
                                        )}
                                        {selectedProvider.isLocal ? '重新检测' : '测试并保存'}
                                    </Button>
                                </div>
                            </div>

                            <Separator className="bg-zinc-100" />

                            {/* 配置表单 */}
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                                {/* 左列：基础配置 + 能力 */}
                                <div className="space-y-6">
                                    <div className="space-y-4">
                                        <h3 className="text-sm font-semibold text-zinc-900 flex items-center gap-2">
                                            <Settings2 className="h-4 w-4 text-zinc-400" />
                                            基础配置
                                        </h3>
                                        <div className="space-y-2">
                                            <label className="text-xs font-medium text-zinc-500 ml-1">API Endpoint (Base URL)</label>
                                            <Input
                                                value={selectedProvider.baseUrl}
                                                onChange={(e) => onUpdateBaseUrl(selectedProvider.id, e.target.value)}
                                                className="bg-zinc-50/50 border-zinc-200 focus:border-violet-500 focus:ring-violet-500"
                                                placeholder="https://api.example.com/v1"
                                            />
                                        </div>
                                        {!selectedProvider.isLocal && (
                                            <div className="space-y-2">
                                                <div className="flex items-center justify-between">
                                                    <label className="text-xs font-medium text-zinc-500 ml-1">API Key</label>
                                                    {selectedProvider.apiKeyUrl && (
                                                        <a
                                                            href={selectedProvider.apiKeyUrl}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="text-[10px] text-violet-600 hover:underline flex items-center gap-1"
                                                        >
                                                            获取密钥 <ExternalLink className="h-2.5 w-2.5" />
                                                        </a>
                                                    )}
                                                </div>
                                                <div className="relative">
                                                    <Input
                                                        type={showApiKeys[selectedProvider.id] ? 'text' : 'password'}
                                                        value={selectedProvider.apiKey}
                                                        onChange={(e) => onUpdateApiKey(selectedProvider.id, e.target.value)}
                                                        placeholder={`请输入 ${selectedProvider.name} API Key`}
                                                        className="pr-10 font-mono text-sm bg-zinc-50/50 border-zinc-200 focus:border-violet-500"
                                                    />
                                                    <button
                                                        type="button"
                                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 transition-colors"
                                                        onClick={() => onSetShowApiKeys(prev => ({ ...prev, [selectedProvider.id]: !prev[selectedProvider.id] }))}
                                                    >
                                                        {showApiKeys[selectedProvider.id] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    <div className="space-y-4">
                                        <h3 className="text-sm font-semibold text-zinc-900 flex items-center gap-2">
                                            <Zap className="h-4 w-4 text-zinc-400" />
                                            服务能力
                                        </h3>
                                        <div className="flex flex-wrap gap-2">
                                            {selectedProvider.capabilities.map(cap => (
                                                <div key={cap} className="px-3 py-1.5 bg-violet-50 text-violet-700 rounded-lg border border-violet-100 flex items-center gap-2">
                                                    <div className="h-1.5 w-1.5 rounded-full bg-violet-400" />
                                                    <span className="text-xs font-medium uppercase">
                                                        {cap === 'llm' ? '对话 (Chat)' : cap === 'embedding' ? '嵌入 (Embedding)' : cap === 'rerank' ? '重排 (Rerank)' : cap === 'tts' ? '语音合成 (TTS)' : '语音识别 (STT)'}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                {/* 右列：模型管理 + 安全提示 */}
                                <div className="space-y-6">
                                    <div className="space-y-4">
                                        <div className="flex items-center justify-between">
                                            <h3 className="text-sm font-semibold text-zinc-900 flex items-center gap-2">
                                                <Box className="h-4 w-4 text-zinc-400" />
                                                可用模型
                                            </h3>
                                            <Button
                                                variant="ghost" size="sm"
                                                onClick={() => onSetEditingModelsFor(editingModelsFor === selectedProvider.id ? null : selectedProvider.id)}
                                                className="h-7 text-xs text-violet-600 hover:text-violet-700 hover:bg-violet-50"
                                            >
                                                {editingModelsFor === selectedProvider.id ? '完成编辑' : '管理模型'}
                                            </Button>
                                        </div>
                                        <div className="bg-zinc-50/50 rounded-xl border border-zinc-200 p-4 min-h-[160px]">
                                            {editingModelsFor === selectedProvider.id ? (
                                                <div className="space-y-4">
                                                    <div className="flex flex-wrap gap-2">
                                                        {selectedProvider.models?.map(model => (
                                                            <span key={model} className="px-2.5 py-1 text-xs bg-white text-zinc-600 rounded-md border border-zinc-200 flex items-center gap-2 shadow-sm">
                                                                {model}
                                                                <button
                                                                    onClick={() => {
                                                                        const newModels = selectedProvider.models?.filter(m => m !== model) || []
                                                                        onUpdateModels(selectedProvider.id, newModels)
                                                                    }}
                                                                    className="text-zinc-400 hover:text-red-500 transition-colors"
                                                                >
                                                                    <Trash2 className="h-3 w-3" />
                                                                </button>
                                                            </span>
                                                        ))}
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <Input
                                                            value={newModelInput}
                                                            onChange={(e) => onSetNewModelInput(e.target.value)}
                                                            placeholder="输入新模型名称..."
                                                            className="h-8 text-xs flex-1 bg-white"
                                                            onKeyDown={(e) => {
                                                                if (e.key === 'Enter' && newModelInput.trim()) {
                                                                    onUpdateModels(selectedProvider.id, [...(selectedProvider.models || []), newModelInput.trim()])
                                                                    onSetNewModelInput('')
                                                                }
                                                            }}
                                                        />
                                                        <Button
                                                            size="sm"
                                                            onClick={() => {
                                                                if (newModelInput.trim()) {
                                                                    onUpdateModels(selectedProvider.id, [...(selectedProvider.models || []), newModelInput.trim()])
                                                                    onSetNewModelInput('')
                                                                }
                                                            }}
                                                            className="h-8 bg-zinc-900 text-white hover:bg-zinc-800"
                                                        >
                                                            添加
                                                        </Button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="flex flex-wrap gap-2">
                                                    {selectedProvider.models && selectedProvider.models.length > 0 ? (
                                                        selectedProvider.models.map(model => (
                                                            <span key={model} className="px-3 py-1 text-xs bg-white text-zinc-700 rounded-md border border-zinc-200 shadow-sm">
                                                                {model}
                                                            </span>
                                                        ))
                                                    ) : (
                                                        <div className="w-full h-24 flex flex-col items-center justify-center text-zinc-400 italic text-xs">
                                                            尚未添加任何模型
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* 安全提示 */}
                                    <div className="p-4 rounded-xl bg-violet-50/50 border border-violet-100">
                                        <div className="flex items-start gap-3">
                                            <AlertCircle className="h-5 w-5 text-violet-500 shrink-0 mt-0.5" />
                                            <div>
                                                <p className="text-xs font-semibold text-violet-900">安全提示</p>
                                                <p className="text-[11px] text-violet-700 mt-1 leading-relaxed">
                                                    API Key 将安全存储在本地，不会上传到任何服务器。请确保从官方渠道获取 API Key，并妥善保管。
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="h-full flex flex-col items-center justify-center text-zinc-400 space-y-4">
                            <div className="p-6 rounded-full bg-zinc-50 border border-zinc-100">
                                <Sparkles className="h-12 w-12 text-zinc-200" />
                            </div>
                            <div className="text-center">
                                <p className="text-sm font-medium text-zinc-600">选择一个供应商进行配置</p>
                                <p className="text-xs text-zinc-400 mt-1">从左侧列表选择您想要使用的 AI 服务商</p>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </TabsContent>
    )
}
