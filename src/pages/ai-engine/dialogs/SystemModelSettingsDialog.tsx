import React from 'react'
import { XCircle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import type { AIProvider, LocalModel, SystemModelConfig } from '../types'

interface SystemModelSettingsDialogProps {
    providers: AIProvider[]
    localModels: LocalModel[]
    systemModelConfig: SystemModelConfig
    onConfigChange: (config: SystemModelConfig) => void
    onSave: () => void
    onClose: () => void
}

// 通用 Model Select 下拉框
function ModelSelect({
    value,
    onChange,
    children
}: {
    value: string
    onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void
    children: React.ReactNode
}) {
    return (
        <select
            className="w-full h-9 px-3 text-sm border border-zinc-200 rounded-md bg-zinc-50 text-zinc-900 focus:border-violet-500 focus:ring-1 focus:ring-violet-500/20"
            value={value}
            onChange={onChange}
        >
            {children}
        </select>
    )
}

function parseValue(value: string): { provider: string; model: string } | null {
    if (!value) return null
    const [provider, ...rest] = value.split('|||')
    return { provider, model: rest.join('|||') }
}

export function SystemModelSettingsDialog({
    providers,
    localModels,
    systemModelConfig,
    onConfigChange,
    onSave,
    onClose
}: SystemModelSettingsDialogProps) {
    const handleChange = (key: keyof SystemModelConfig, value: string) => {
        const parsed = parseValue(value)
        onConfigChange({ ...systemModelConfig, [key]: parsed })
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <Card className="w-[500px] max-h-[80vh] overflow-auto bg-white shadow-2xl">
                <CardHeader className="border-b border-zinc-100">
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle className="text-base font-medium text-zinc-900">系统模型设置</CardTitle>
                            <CardDescription className="text-xs text-zinc-500 mt-1">配置系统各功能使用的默认模型</CardDescription>
                        </div>
                        <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
                            <XCircle className="h-4 w-4" />
                        </Button>
                    </div>
                </CardHeader>
                <CardContent className="p-5 space-y-5">
                    {/* 推理模型 */}
                    <div className="space-y-2">
                        <div className="flex items-center gap-2">
                            <label className="text-sm font-medium text-zinc-900">系统推理模型</label>
                            <span className="px-1.5 py-0.5 text-[10px] bg-blue-100 text-blue-700 rounded">LLM</span>
                        </div>
                        <ModelSelect
                            value={systemModelConfig.llm ? `${systemModelConfig.llm.provider}|||${systemModelConfig.llm.model}` : ''}
                            onChange={(e) => handleChange('llm', e.target.value)}
                        >
                            <option value="">未设置</option>
                            {providers.filter(p => p.capabilities.includes('llm') && (p.status === 'connected' || p.isLocal)).map(p => (
                                <optgroup key={p.id} label={p.name} className="font-normal">
                                    {p.models?.filter(m => !m.includes('embedding')).map(m => (
                                        <option key={`${p.id}|||${m}`} value={`${p.id}|||${m}`}>{m}</option>
                                    ))}
                                </optgroup>
                            ))}
                        </ModelSelect>
                    </div>

                    {/* Embedding 模型 */}
                    <div className="space-y-2">
                        <div className="flex items-center gap-2">
                            <label className="text-sm font-medium text-zinc-900">Embedding 模型</label>
                            <span className="px-1.5 py-0.5 text-[10px] bg-violet-100 text-violet-700 rounded">向量化</span>
                        </div>
                        <ModelSelect
                            value={systemModelConfig.embedding ? `${systemModelConfig.embedding.provider}|||${systemModelConfig.embedding.model}` : ''}
                            onChange={(e) => handleChange('embedding', e.target.value)}
                        >
                            <option value="">未设置</option>
                            {providers.filter(p => p.capabilities.includes('embedding') && (p.status === 'connected' || p.isLocal)).map(p => (
                                <optgroup key={p.id} label={p.name} className="font-normal">
                                    {p.models?.filter(m => m.includes('embedding') || m.includes('text-embedding')).map(m => (
                                        <option key={`${p.id}|||${m}`} value={`${p.id}|||${m}`}>{m}</option>
                                    ))}
                                </optgroup>
                            ))}
                            {localModels.filter(m => m.type === 'embedding').length > 0 && (
                                <optgroup label="HuggingFace 本地">
                                    {localModels.filter(m => m.type === 'embedding').map(m => (
                                        <option key={`huggingface|||${m.name}`} value={`huggingface|||${m.name}`}>{m.name}</option>
                                    ))}
                                </optgroup>
                            )}
                        </ModelSelect>
                        <p className="text-xs text-zinc-500">用于文本向量化和语义检索</p>
                    </div>

                    {/* Rerank 模型 */}
                    <div className="space-y-2">
                        <div className="flex items-center gap-2">
                            <label className="text-sm font-medium text-zinc-900">Rerank 模型</label>
                            <span className="px-1.5 py-0.5 text-[10px] bg-emerald-100 text-emerald-700 rounded">重排序</span>
                        </div>
                        <ModelSelect
                            value={systemModelConfig.rerank ? `${systemModelConfig.rerank.provider}|||${systemModelConfig.rerank.model}` : ''}
                            onChange={(e) => handleChange('rerank', e.target.value)}
                        >
                            <option value="">未设置（使用本地模型）</option>
                            {localModels.filter(m => m.type === 'reranker').length > 0 && (
                                <optgroup label="HuggingFace 本地">
                                    {localModels.filter(m => m.type === 'reranker').map(m => (
                                        <option key={`huggingface|||${m.name}`} value={`huggingface|||${m.name}`}>{m.name}</option>
                                    ))}
                                </optgroup>
                            )}
                        </ModelSelect>
                        <p className="text-xs text-zinc-500">用于检索结果重排序优化</p>
                    </div>

                    {/* 翻译模型 */}
                    <div className="space-y-2">
                        <div className="flex items-center gap-2">
                            <label className="text-sm font-medium text-zinc-900">翻译模型</label>
                            <span className="px-1.5 py-0.5 text-[10px] bg-blue-100 text-blue-700 rounded">Translation</span>
                        </div>
                        <ModelSelect
                            value={systemModelConfig.translation ? `${systemModelConfig.translation.provider}|||${systemModelConfig.translation.model}` : ''}
                            onChange={(e) => handleChange('translation', e.target.value)}
                        >
                            <option value="">未设置</option>
                            {localModels.filter(m => m.type === 'translation').length > 0 && (
                                <optgroup label="HuggingFace 本地">
                                    {localModels.filter(m => m.type === 'translation').map(m => (
                                        <option key={`huggingface|||${m.name}`} value={`huggingface|||${m.name}`}>{m.name}</option>
                                    ))}
                                </optgroup>
                            )}
                        </ModelSelect>
                        <p className="text-xs text-zinc-500">用于多语言翻译</p>
                    </div>

                    {/* STT 模型 */}
                    <div className="space-y-2">
                        <div className="flex items-center gap-2">
                            <label className="text-sm font-medium text-zinc-900">语音转文本模型</label>
                            <span className="px-1.5 py-0.5 text-[10px] bg-amber-100 text-amber-700 rounded">STT</span>
                        </div>
                        <ModelSelect
                            value={systemModelConfig.stt ? `${systemModelConfig.stt.provider}|||${systemModelConfig.stt.model}` : ''}
                            onChange={(e) => handleChange('stt', e.target.value)}
                        >
                            <option value="">未设置</option>
                            {providers.filter(p => p.capabilities.includes('stt') && (p.status === 'connected' || p.isLocal)).map(p => (
                                <optgroup key={p.id} label={p.name} className="font-normal">
                                    <option value={`${p.id}|||whisper`}>whisper</option>
                                </optgroup>
                            ))}
                            {localModels.filter(m => m.type === 'whisper').length > 0 && (
                                <optgroup label="HuggingFace 本地">
                                    {localModels.filter(m => m.type === 'whisper').map(m => (
                                        <option key={`huggingface|||${m.name}`} value={`huggingface|||${m.name}`}>{m.name}</option>
                                    ))}
                                </optgroup>
                            )}
                        </ModelSelect>
                    </div>

                    {/* TTS 模型 */}
                    <div className="space-y-2">
                        <div className="flex items-center gap-2">
                            <label className="text-sm font-medium text-zinc-900">文本转语音模型</label>
                            <span className="px-1.5 py-0.5 text-[10px] bg-pink-100 text-pink-700 rounded">TTS</span>
                        </div>
                        <ModelSelect
                            value={systemModelConfig.tts ? `${systemModelConfig.tts.provider}|||${systemModelConfig.tts.model}` : ''}
                            onChange={(e) => handleChange('tts', e.target.value)}
                        >
                            <option value="">未设置</option>
                            {providers.filter(p => p.capabilities.includes('tts') && (p.status === 'connected' || p.isLocal)).map(p => (
                                <optgroup key={p.id} label={p.name} className="font-normal">
                                    <option value={`${p.id}|||tts-1`}>tts-1</option>
                                    <option value={`${p.id}|||tts-1-hd`}>tts-1-hd</option>
                                </optgroup>
                            ))}
                        </ModelSelect>
                    </div>
                </CardContent>
                <div className="p-4 border-t border-zinc-100 flex justify-end gap-2">
                    <Button variant="outline" onClick={onClose}>取消</Button>
                    <Button onClick={onSave}>保存</Button>
                </div>
            </Card>
        </div>
    )
}
