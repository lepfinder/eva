import React from 'react'
import { XCircle, Eye, EyeOff } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface CustomProviderData {
    name: string
    baseUrl: string
    apiKey: string
    models: string
}

interface AddCustomProviderDialogProps {
    data: CustomProviderData
    showApiKey: boolean
    onDataChange: (data: CustomProviderData) => void
    onToggleApiKey: () => void
    onAdd: () => void
    onClose: () => void
}

export function AddCustomProviderDialog({
    data,
    showApiKey,
    onDataChange,
    onToggleApiKey,
    onAdd,
    onClose
}: AddCustomProviderDialogProps) {
    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <Card className="w-full max-w-md bg-white">
                <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle className="text-base font-medium text-zinc-900">添加自定义 OpenAI 适配供应商</CardTitle>
                            <CardDescription className="text-sm text-zinc-500 mt-1">配置兼容 OpenAI API 格式的第三方服务</CardDescription>
                        </div>
                        <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
                            <XCircle className="h-4 w-4" />
                        </Button>
                    </div>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-zinc-700">供应商名称 *</label>
                        <Input
                            value={data.name}
                            onChange={(e) => onDataChange({ ...data, name: e.target.value })}
                            placeholder="例如：LocalAI、vLLM、One API"
                            className="bg-white"
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium text-zinc-700">API Base URL *</label>
                        <Input
                            value={data.baseUrl}
                            onChange={(e) => onDataChange({ ...data, baseUrl: e.target.value })}
                            placeholder="http://localhost:8080/v1"
                            className="bg-white font-mono"
                        />
                        <p className="text-xs text-zinc-500">兼容 OpenAI API 格式的服务地址，如 LocalAI、vLLM、One API 等</p>
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium text-zinc-700">API Key（可选）</label>
                        <div className="relative">
                            <Input
                                type={showApiKey ? 'text' : 'password'}
                                value={data.apiKey}
                                onChange={(e) => onDataChange({ ...data, apiKey: e.target.value })}
                                placeholder="sk-xxx"
                                className="bg-white pr-10 font-mono"
                            />
                            <button
                                type="button"
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
                                onClick={onToggleApiKey}
                            >
                                {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </button>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium text-zinc-700">模型列表（可选）</label>
                        <Input
                            value={data.models}
                            onChange={(e) => onDataChange({ ...data, models: e.target.value })}
                            placeholder="gpt-3.5-turbo, gpt-4, local-model"
                            className="bg-white font-mono"
                        />
                        <p className="text-xs text-zinc-500">多个模型用逗号分隔，留空则使用 default-model</p>
                    </div>
                </CardContent>
                <div className="p-4 border-t border-zinc-100 flex justify-end gap-2">
                    <Button variant="outline" onClick={onClose}>取消</Button>
                    <Button onClick={onAdd} className="bg-violet-600 hover:bg-violet-700">
                        添加供应商
                    </Button>
                </div>
            </Card>
        </div>
    )
}
