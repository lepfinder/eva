import React, { useState, useEffect } from 'react'
import { Sparkles, Box, Globe } from 'lucide-react'
import { PenSquare } from 'lucide-react'
import { message } from 'antd'
import type { AIProvider, SystemModelConfig } from '../types'

// 默认供应商列表（初始数据）
const DEFAULT_PROVIDERS: AIProvider[] = [
    {
        id: 'deepseek',
        name: 'DeepSeek',
        icon: <Sparkles className="h-5 w-5 text-blue-500" />,
        baseUrl: 'https://api.deepseek.com',
        apiKey: '',
        apiKeyUrl: 'https://platform.deepseek.com/api_keys',
        status: 'disconnected',
        models: ['deepseek-chat', 'deepseek-coder', 'deepseek-reasoner'],
        capabilities: ['llm']
    },
    {
        id: 'ollama',
        name: 'Ollama',
        icon: <Box className="h-5 w-5 text-zinc-700" />,
        baseUrl: 'http://localhost:11434',
        apiKey: '',
        status: 'disconnected',
        models: [],
        capabilities: ['llm', 'embedding'],
        isLocal: true
    },
    {
        id: 'qwen',
        name: '通义千问',
        icon: <Sparkles className="h-5 w-5 text-violet-500" />,
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        apiKey: '',
        apiKeyUrl: 'https://bailian.console.aliyun.com/cn-beijing?tab=model#/api-key',
        status: 'disconnected',
        models: ['qwen-turbo', 'qwen-plus', 'qwen-max', 'text-embedding-v3'],
        capabilities: ['llm', 'embedding']
    },
    {
        id: 'openai',
        name: 'OpenAI',
        icon: <Globe className="h-5 w-5 text-emerald-600" />,
        baseUrl: 'https://api.openai.com/v1',
        apiKey: '',
        apiKeyUrl: 'https://platform.openai.com/api-keys',
        status: 'disconnected',
        models: ['gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo', 'text-embedding-3-small'],
        capabilities: ['llm', 'embedding', 'tts', 'stt']
    },
    {
        id: 'anthropic',
        name: 'Anthropic Claude',
        icon: <Box className="h-5 w-5 text-orange-500" />,
        baseUrl: 'https://api.anthropic.com',
        apiKey: '',
        apiKeyUrl: 'https://console.anthropic.com/settings/keys',
        status: 'disconnected',
        models: ['claude-3-5-sonnet', 'claude-3-opus', 'claude-3-haiku'],
        capabilities: ['llm']
    },
    {
        id: 'google',
        name: 'Google Gemini',
        icon: <Sparkles className="h-5 w-5 text-sky-500" />,
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        apiKey: '',
        apiKeyUrl: 'https://aistudio.google.com/app/apikey',
        status: 'disconnected',
        models: ['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.0-flash-exp'],
        capabilities: ['llm', 'embedding']
    },
    {
        id: 'moonshot',
        name: '月之暗面',
        icon: <Sparkles className="h-5 w-5 text-indigo-500" />,
        baseUrl: 'https://api.moonshot.cn/v1',
        apiKey: '',
        apiKeyUrl: 'https://platform.moonshot.cn/console/api-keys',
        status: 'disconnected',
        models: ['kimi-k2', 'moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
        capabilities: ['llm']
    },
    {
        id: 'zhipu',
        name: '智谱 AI',
        icon: <Sparkles className="h-5 w-5 text-blue-500" />,
        baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
        apiKey: '',
        apiKeyUrl: 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys',
        status: 'disconnected',
        models: ['glm-4', 'glm-4-plus', 'glm-4-air', 'glm-4-flash'],
        capabilities: ['llm']
    },
    {
        id: 'qiniu',
        name: '七牛云',
        icon: <Sparkles className="h-5 w-5 text-blue-400" />,
        baseUrl: 'https://api.qnaigc.com/v1',
        apiKey: '',
        apiKeyUrl: 'https://portal.qiniu.com/ai-inference/api-key',
        status: 'disconnected',
        models: [],
        capabilities: ['llm']
    },
    {
        id: 'nvidia',
        name: 'NVIDIA NIM',
        icon: <Sparkles className="h-5 w-5 text-emerald-500" />,
        baseUrl: 'https://integrate.api.nvidia.com/v1',
        apiKey: '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',
        apiKeyUrl: 'https://build.nvidia.com/explore/discover',
        status: 'disconnected',
        models: ['minimaxai/minimax-m2.7'],
        capabilities: ['llm']
    }
]

interface CustomProviderData {
    name: string
    baseUrl: string
    apiKey: string
    models: string
}

interface UseAIProvidersManagerReturn {
    providers: AIProvider[]
    selectedProviderId: string
    selectedProvider: AIProvider | undefined
    editingModelsFor: string | null
    newModelInput: string
    showApiKeys: Record<string, boolean>
    showAddCustomProvider: boolean
    customProviderData: CustomProviderData
    systemModelConfig: SystemModelConfig
    showSystemModelSettings: boolean
    setSelectedProviderId: (id: string) => void
    setEditingModelsFor: (id: string | null) => void
    setNewModelInput: (v: string) => void
    setShowApiKeys: React.Dispatch<React.SetStateAction<Record<string, boolean>>>
    setShowAddCustomProvider: (v: boolean) => void
    setCustomProviderData: (data: CustomProviderData) => void
    setSystemModelConfig: React.Dispatch<React.SetStateAction<SystemModelConfig>>
    setShowSystemModelSettings: (v: boolean) => void
    handleUpdateBaseUrl: (providerId: string, baseUrl: string) => Promise<void>
    handleUpdateApiKey: (providerId: string, apiKey: string) => Promise<void>
    handleUpdateModels: (providerId: string, models: string[]) => Promise<void>
    handleTestConnection: (providerId: string) => Promise<void>
    handleAddCustomProvider: () => Promise<void>
    handleDeleteCustomProvider: (providerId: string) => Promise<void>
    handleSaveSystemModelConfig: () => Promise<void>
}

export function useAIProvidersManager(messageApi: ReturnType<typeof message.useMessage>[0]): UseAIProvidersManagerReturn {
    const [providers, setProviders] = useState<AIProvider[]>(DEFAULT_PROVIDERS)
    const [selectedProviderId, setSelectedProviderId] = useState<string>('deepseek')
    const [editingModelsFor, setEditingModelsFor] = useState<string | null>(null)
    const [newModelInput, setNewModelInput] = useState('')
    const [showApiKeys, setShowApiKeys] = useState<Record<string, boolean>>({})
    const [showAddCustomProvider, setShowAddCustomProvider] = useState(false)
    const [customProviderData, setCustomProviderData] = useState<CustomProviderData>({
        name: '', baseUrl: '', apiKey: '', models: ''
    })
    const [systemModelConfig, setSystemModelConfig] = useState<SystemModelConfig>({
        llm: null, embedding: null, rerank: null, translation: null, tts: null, stt: null
    })
    const [showSystemModelSettings, setShowSystemModelSettings] = useState(false)

    const selectedProvider = providers.find(p => p.id === selectedProviderId)

    // 加载持久化的供应商配置
    useEffect(() => {
        const loadProviderConfigs = async () => {
            try {
                const savedConfigs = await window.api.aiProviderGetAll()
                if (savedConfigs && savedConfigs.length > 0) {
                    setProviders(prev => prev.map(p => {
                        const saved = savedConfigs.find(s => s.id === p.id)
                        if (saved) {
                            return {
                                ...p,
                                apiKey: saved.apiKey,
                                baseUrl: saved.baseUrl || p.baseUrl,
                                status: saved.status,
                                models: saved.models && saved.models.length > 0 ? saved.models : p.models
                            }
                        }
                        return p
                    }))
                }
            } catch (err) {
                console.error('Failed to load provider configs:', err)
            }

            // 自动获取 Ollama 本地模型列表
            try {
                const response = await fetch('http://localhost:11434/api/tags')
                if (response.ok) {
                    const data = await response.json()
                    const modelNames = data.models?.map((m: { name: string }) => m.name) || []
                    setProviders(prev => prev.map(p =>
                        p.id === 'ollama' ? { ...p, models: modelNames, status: 'connected' } : p
                    ))
                }
            } catch (err) {
                console.log('Ollama not available:', err)
            }

            // 加载系统模型配置
            try {
                const savedSystemModelConfig = await window.api.aiEngineGetSystemModelConfig()
                if (savedSystemModelConfig) {
                    setSystemModelConfig(savedSystemModelConfig)
                }
            } catch (err) {
                console.error('Failed to load system model config:', err)
            }
        }
        loadProviderConfigs()
    }, [])

    const handleUpdateBaseUrl = async (providerId: string, baseUrl: string) => {
        setProviders(prev => prev.map(p =>
            p.id === providerId ? { ...p, baseUrl: baseUrl.trim(), status: 'disconnected' } : p
        ))
        const provider = providers.find(p => p.id === providerId)
        if (provider) {
            try {
                await window.api.aiProviderUpsert({
                    id: providerId,
                    apiKey: provider.apiKey,
                    baseUrl: baseUrl.trim(),
                    status: 'disconnected',
                    models: provider.models
                })
            } catch (err) {
                console.error('Failed to save provider baseUrl:', err)
            }
        }
    }

    const handleUpdateApiKey = async (providerId: string, apiKey: string) => {
        setProviders(prev => prev.map(p =>
            p.id === providerId ? { ...p, apiKey: apiKey.trim(), status: 'disconnected' } : p
        ))
        const provider = providers.find(p => p.id === providerId)
        if (provider) {
            try {
                await window.api.aiProviderUpsert({
                    id: providerId,
                    apiKey: apiKey.trim(),
                    baseUrl: provider.baseUrl,
                    status: 'disconnected',
                    models: provider.models
                })
            } catch (err) {
                console.error('Failed to save provider config:', err)
            }
        }
    }

    const handleUpdateModels = async (providerId: string, models: string[]) => {
        setProviders(prev => prev.map(p =>
            p.id === providerId ? { ...p, models } : p
        ))
        const provider = providers.find(p => p.id === providerId)
        if (provider) {
            try {
                const saveStatus = provider.status === 'testing' ? 'disconnected' : provider.status
                await window.api.aiProviderUpsert({
                    id: providerId,
                    apiKey: provider.apiKey,
                    baseUrl: provider.baseUrl,
                    status: saveStatus,
                    models
                })
            } catch (err) {
                console.error('Failed to save provider models:', err)
            }
        }
    }

    const handleTestConnection = async (providerId: string) => {
        setProviders(prev => prev.map(p =>
            p.id === providerId ? { ...p, status: 'testing' } : p
        ))
        await new Promise(resolve => setTimeout(resolve, 1500))
        const provider = providers.find(p => p.id === providerId)
        const success = provider?.isLocal || (provider?.apiKey && provider.apiKey.length > 10)
        const newStatus = success ? 'connected' : 'error'
        setProviders(prev => prev.map(p =>
            p.id === providerId ? { ...p, status: newStatus } : p
        ))
        if (provider) {
            try {
                await window.api.aiProviderUpsert({
                    id: providerId,
                    apiKey: provider.apiKey,
                    baseUrl: provider.baseUrl,
                    status: newStatus
                })
            } catch (err) {
                console.error('Failed to save provider config:', err)
            }
        }
    }

    const handleAddCustomProvider = async () => {
        if (!customProviderData.name.trim() || !customProviderData.baseUrl.trim()) {
            messageApi.error('请填写供应商名称和 API Base URL')
            return
        }
        const providerId = `custom-${Date.now()}`
        const models = customProviderData.models.split(',').map(m => m.trim()).filter(m => m.length > 0)
        const newProvider: AIProvider = {
            id: providerId,
            name: customProviderData.name.trim(),
            icon: <PenSquare className="h-5 w-5 text-indigo-600" />,
            baseUrl: customProviderData.baseUrl.trim(),
            apiKey: customProviderData.apiKey.trim(),
            status: 'disconnected',
            models: models.length > 0 ? models : ['default-model'],
            capabilities: ['llm'],
            isCustom: true
        }
        setProviders(prev => [...prev, newProvider])
        try {
            await window.api.aiProviderUpsert({
                id: providerId,
                apiKey: customProviderData.apiKey.trim(),
                baseUrl: customProviderData.baseUrl.trim(),
                status: 'disconnected',
                models
            })
            messageApi.success('自定义供应商已添加')
            setShowAddCustomProvider(false)
            setCustomProviderData({ name: '', baseUrl: '', apiKey: '', models: '' })
        } catch (err) {
            console.error('Failed to save custom provider:', err)
            messageApi.error('保存失败，请重试')
        }
    }

    const handleDeleteCustomProvider = async (providerId: string) => {
        const provider = providers.find(p => p.id === providerId)
        if (!provider?.isCustom) return
        setProviders(prev => prev.filter(p => p.id !== providerId))
        try {
            await window.api.aiProviderDelete(providerId)
            messageApi.success('已删除自定义供应商')
        } catch (err) {
            console.error('Failed to delete custom provider:', err)
        }
    }

    const handleSaveSystemModelConfig = async () => {
        try {
            await window.api.aiEngineSaveSystemModelConfig(systemModelConfig)
            messageApi.success('系统模型设置已保存')
            setShowSystemModelSettings(false)
        } catch (err) {
            messageApi.error('保存失败')
            console.error('Failed to save system model config:', err)
        }
    }

    return {
        providers,
        selectedProviderId,
        selectedProvider,
        editingModelsFor,
        newModelInput,
        showApiKeys,
        showAddCustomProvider,
        customProviderData,
        systemModelConfig,
        showSystemModelSettings,
        setSelectedProviderId,
        setEditingModelsFor,
        setNewModelInput,
        setShowApiKeys,
        setShowAddCustomProvider,
        setCustomProviderData,
        setSystemModelConfig,
        setShowSystemModelSettings,
        handleUpdateBaseUrl,
        handleUpdateApiKey,
        handleUpdateModels,
        handleTestConnection,
        handleAddCustomProvider,
        handleDeleteCustomProvider,
        handleSaveSystemModelConfig
    }
}
