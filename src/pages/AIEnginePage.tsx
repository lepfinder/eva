/**
 * AI Engine 管理页面
 * 四个 Tab：运行看板、模型仓库、外部接入、引擎设置
 */
import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Cpu, Play, Square, RefreshCcw, Circle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Terminal, Database, Layers, Wrench } from 'lucide-react'
import { usePythonService } from '@/hooks/usePythonService'
import { cn } from '@/lib/utils'
import { message, ConfigProvider } from 'antd'
import { AIEngineSetupWizard } from '@/components/AIEngineSetupWizard'

// 子组件
import { DashboardTab } from './ai-engine/tabs/DashboardTab'
import { ModelsTab } from './ai-engine/tabs/ModelsTab'
import { ProvidersTab } from './ai-engine/tabs/ProvidersTab'
import { SettingsTab } from './ai-engine/tabs/SettingsTab'
import { AddModelDialog } from './ai-engine/dialogs/AddModelDialog'
import { SystemModelSettingsDialog } from './ai-engine/dialogs/SystemModelSettingsDialog'
import { AddCustomProviderDialog } from './ai-engine/dialogs/AddCustomProviderDialog'

// Hooks
import { useLocalModels } from './ai-engine/hooks/useLocalModels'
import { useAIProvidersManager } from './ai-engine/hooks/useAIProvidersManager'

// 类型
import type { LogEntry, ResourceMetrics, AIEngineConfig } from './ai-engine/types'

// Ant Design 主题配置
const antdTheme = {
    token: {
        colorPrimary: '#8b5cf6', // violet-500
        borderRadius: 8
    }
}

export function AIEnginePage(): React.ReactElement {
    const {
        serviceInfo,
        isLoading,
        isConnected,
        startService,
        stopService,
        restartService
    } = usePythonService()

    const [messageApi, contextHolder] = message.useMessage()

    // 运行看板状态
    const [logs, setLogs] = useState<LogEntry[]>([])
    const [logLevel, setLogLevel] = useState<'debug' | 'info' | 'error'>('info')
    const [apiLatency, setApiLatency] = useState<number | null>(null)
    const [metrics, setMetrics] = useState<ResourceMetrics>({ cpu: 0, memory: 0, gpu: 0 })
    const [isConsoleExpanded, setIsConsoleExpanded] = useState(false)

    // 引擎设置状态
    const [showSetupWizard, setShowSetupWizard] = useState(false)
    const [aiEngineConfig, setAiEngineConfig] = useState<AIEngineConfig | null>(null)
    const [manualPath, setManualPath] = useState('')
    const [manualValidation, setManualValidation] = useState<{
        valid: boolean; error?: string; hasVenv: boolean; hasPython: boolean
    } | null>(null)
    const [isValidating, setIsValidating] = useState(false)

    const logsContainerRef = useRef<HTMLDivElement>(null)
    const logIdRef = useRef(0)

    // 子状态 Hooks
    const localModelsState = useLocalModels()
    const providersState = useAIProvidersManager(messageApi)

    const currentStatus = serviceInfo?.status || 'stopped'

    // 添加日志
    const addLog = useCallback((level: LogEntry['level'], msg: string) => {
        const entry: LogEntry = {
            id: logIdRef.current++,
            timestamp: new Date(),
            level,
            message: msg
        }
        setLogs(prev => [...prev.slice(-1000), entry])
    }, [])

    // 滚动到日志底部
    useEffect(() => {
        if (logsContainerRef.current) {
            logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight
        }
    }, [logs])

    // 监听后端日志
    useEffect(() => {
        const removeListener = window.api.onAIEngineLog((msg) => {
            let level: LogEntry['level'] = 'info'
            if (msg.includes('ERROR') || msg.includes('CRITICAL') || msg.includes('Traceback')) level = 'error'
            else if (msg.includes('WARNING') || msg.includes('WARN')) level = 'warn'
            else if (msg.includes('DEBUG')) level = 'debug'
            addLog(level, msg.replace(/^\[Python.*?\]\s*/, ''))
        })
        return () => removeListener()
    }, [addLog])

    // 初始化日志
    useEffect(() => {
        if (logs.length === 0) {
            addLog('info', '→ AI Engine 控制台已就绪')
            if (serviceInfo?.status === 'running') {
                addLog('info', `✓ 服务运行中 (PID: ${serviceInfo.pid})`)
            }
        }
    }, [serviceInfo, addLog, logs.length])

    // 加载 AI Engine 配置
    useEffect(() => {
        const loadConfig = async () => {
            try {
                const config = await window.api.aiEngineGetConfig()
                setAiEngineConfig(config)
            } catch (err) {
                console.error('Failed to load AI Engine config:', err)
            }
        }
        loadConfig()
    }, [])

    // 测量 API 延迟
    useEffect(() => {
        const measureLatency = async () => {
            if (!isConnected) { setApiLatency(null); return }
            try {
                const start = performance.now()
                await fetch(`http://127.0.0.1:${serviceInfo?.port || 18888}/health`)
                setApiLatency(Math.round(performance.now() - start))
            } catch {
                setApiLatency(null)
            }
        }
        measureLatency()
        const interval = setInterval(measureLatency, 5000)
        return () => clearInterval(interval)
    }, [isConnected, serviceInfo?.port])

    // 真实资源监控
    useEffect(() => {
        if (currentStatus !== 'running') {
            setMetrics({ cpu: 0, memory: 0, gpu: null })
            return
        }
        const fetchMetrics = async () => {
            try {
                const response = await fetch(`http://127.0.0.1:${serviceInfo?.port || 18888}/metrics`)
                if (response.ok) {
                    const data = await response.json()
                    setMetrics({
                        cpu: data.cpu_percent || 0,
                        memory: data.memory_mb || 0,
                        memoryPercent: data.memory_percent,
                        gpu: data.gpu_percent,
                        gpuMemory: data.gpu_memory_mb,
                        threads: data.threads,
                        openFiles: data.open_files
                    })
                }
            } catch (err) {
                console.warn('Failed to fetch metrics:', err)
            }
        }
        fetchMetrics()
        const interval = setInterval(fetchMetrics, 3000)
        return () => clearInterval(interval)
    }, [currentStatus, serviceInfo?.port])

    // 服务操作
    const handleStart = async () => {
        messageApi.open({ type: 'loading', content: '正在启动 AI Engine...', key: 'service_status' })
        addLog('info', '→ 正在启动 AI Engine 服务...')
        const success = await startService()
        if (success) {
            messageApi.open({ type: 'success', content: 'AI Engine 启动成功', key: 'service_status' })
            addLog('info', '✓ 服务启动成功')
        } else {
            messageApi.open({ type: 'error', content: 'AI Engine 启动失败，请检查配置', key: 'service_status' })
            addLog('error', '✗ 服务启动失败')
        }
    }

    const handleStop = async () => {
        messageApi.open({ type: 'loading', content: '正在停止 AI Engine...', key: 'service_status' })
        addLog('info', '→ 正在停止服务...')
        const success = await stopService()
        if (success) {
            messageApi.open({ type: 'success', content: 'AI Engine 已停止', key: 'service_status' })
            addLog('info', '✓ 服务已停止')
        } else {
            messageApi.open({ type: 'error', content: '停止服务失败', key: 'service_status' })
        }
    }

    const handleRestart = async () => {
        messageApi.open({ type: 'loading', content: '正在重启 AI Engine...', key: 'service_status' })
        addLog('info', '→ 正在重启服务...')
        const success = await restartService()
        if (success) {
            messageApi.open({ type: 'success', content: 'AI Engine 重启成功', key: 'service_status' })
            addLog('info', '✓ 服务重启完成')
        } else {
            messageApi.open({ type: 'error', content: 'AI Engine 重启失败', key: 'service_status' })
            addLog('error', '✗ 服务重启失败')
        }
    }

    // 手动配置操作
    const handleValidatePath = async () => {
        if (!manualPath) return
        setIsValidating(true)
        try {
            const result = await window.api.aiEngineValidateManualPath(manualPath)
            setManualValidation(result)
        } finally {
            setIsValidating(false)
        }
    }

    const handleSaveManualConfig = async () => {
        if (!manualPath || !manualValidation?.valid) return
        const success = await window.api.aiEngineSaveManualConfig(manualPath)
        if (success) {
            const config = await window.api.aiEngineGetConfig()
            setAiEngineConfig(config)
        }
    }

    const handleResetConfig = async () => {
        await window.api.aiEngineResetConfig()
        const config = await window.api.aiEngineGetConfig()
        setAiEngineConfig(config)
        setManualPath('')
        setManualValidation(null)
    }

    // 状态工具函数
    const getStatusColor = () => {
        switch (currentStatus) {
            case 'running': return 'text-emerald-600'
            case 'starting': return 'text-amber-600'
            case 'error': return 'text-red-600'
            default: return 'text-zinc-400'
        }
    }

    const getStatusDotColor = () => {
        switch (currentStatus) {
            case 'running': return 'bg-emerald-500'
            case 'starting': return 'bg-amber-500'
            case 'error': return 'bg-red-500'
            default: return 'bg-zinc-400'
        }
    }

    const getStatusText = () => {
        switch (currentStatus) {
            case 'running': return 'EVA is breathing...'
            case 'starting': return '启动中'
            case 'error': return '错误'
            default: return '已停止'
        }
    }

    const formatUptime = (ms: number | null) => {
        if (!ms) return '—'
        const seconds = Math.floor(ms / 1000)
        const minutes = Math.floor(seconds / 60)
        const hours = Math.floor(minutes / 60)
        if (hours > 0) return `${hours}h ${minutes % 60}m`
        if (minutes > 0) return `${minutes}m ${seconds % 60}s`
        return `${seconds}s`
    }

    const formatBytes = (bytes: number) => {
        if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
        if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
        return `${(bytes / 1024).toFixed(1)} KB`
    }

    const getModelTypeLabel = (type: string) => {
        switch (type) {
            case 'embedding': return { label: 'Embedding', color: 'bg-violet-100 text-violet-700 border-violet-200' }
            case 'reranker': return { label: 'Reranker', color: 'bg-indigo-100 text-indigo-700 border-indigo-200' }
            case 'llm': return { label: 'LLM', color: 'bg-emerald-100 text-emerald-700 border-emerald-200' }
            case 'whisper': return { label: 'Whisper', color: 'bg-orange-100 text-orange-700 border-orange-200' }
            case 'translation': return { label: 'Translation', color: 'bg-blue-100 text-blue-700 border-blue-200' }
            default: return { label: '其他', color: 'bg-zinc-100 text-zinc-700 border-zinc-200' }
        }
    }

    return (
        <ConfigProvider theme={antdTheme}>
            {contextHolder}
            <div className="h-full flex flex-col bg-zinc-50">
                {/* 页面头部 */}
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-4">
                        <div className="relative h-11 w-11 rounded-xl bg-white border border-zinc-200 flex items-center justify-center shadow-sm">
                            <Cpu className="h-5 w-5 text-violet-600" />
                            <div className="absolute -top-1 -right-1">
                                <div className="relative">
                                    {currentStatus === 'running' && (
                                        <div className={cn("absolute inset-0 rounded-full animate-ping opacity-40", getStatusDotColor())} />
                                    )}
                                    <Circle className={cn("h-3 w-3 fill-current relative z-10", getStatusDotColor(), "text-white stroke-white stroke-2")} />
                                </div>
                            </div>
                        </div>
                        <div>
                            <h1 className="text-xl font-semibold text-zinc-900 tracking-tight">AI Engine</h1>
                            <p className="text-sm text-zinc-500">本地 AI 后端服务管理</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button
                            variant="outline" size="sm"
                            disabled={isLoading || currentStatus === 'starting'}
                            onClick={currentStatus === 'running' ? handleStop : handleStart}
                            className={cn(
                                "gap-2 border-zinc-200 bg-white shadow-sm hover:shadow",
                                currentStatus === 'running'
                                    ? "text-zinc-600 hover:text-red-600 hover:border-red-200 hover:bg-red-50"
                                    : "text-zinc-900 hover:text-violet-600 hover:border-violet-200 hover:bg-violet-50"
                            )}
                        >
                            {currentStatus === 'running' ? (
                                <><Square className="h-3.5 w-3.5 fill-current" />停止</>
                            ) : (
                                <><Play className="h-3.5 w-3.5 fill-current" />启动</>
                            )}
                        </Button>
                        <Button
                            variant="outline" size="sm"
                            disabled={isLoading || currentStatus !== 'running'}
                            onClick={handleRestart}
                            className="gap-2 border-zinc-200 bg-white shadow-sm hover:shadow text-zinc-600 hover:text-zinc-900"
                        >
                            <RefreshCcw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
                            重启
                        </Button>
                    </div>
                </div>

                {/* Tabs */}
                <Tabs defaultValue="dashboard" className="flex-1 flex flex-col min-h-0">
                    <TabsList className="w-fit bg-white border border-zinc-200 shadow-sm mb-4">
                        <TabsTrigger value="dashboard" className="gap-2 data-[state=active]:bg-violet-50 data-[state=active]:text-violet-700">
                            <Terminal className="h-4 w-4" />
                            运行看板
                        </TabsTrigger>
                        <TabsTrigger value="models" className="gap-2 data-[state=active]:bg-violet-50 data-[state=active]:text-violet-700">
                            <Database className="h-4 w-4" />
                            HuggingFace 模型
                        </TabsTrigger>
                        <TabsTrigger value="providers" className="gap-2 data-[state=active]:bg-violet-50 data-[state=active]:text-violet-700">
                            <Layers className="h-4 w-4" />
                            模型供应商
                        </TabsTrigger>
                        <TabsTrigger value="settings" className="gap-2 data-[state=active]:bg-violet-50 data-[state=active]:text-violet-700">
                            <Wrench className="h-4 w-4" />
                            引擎设置
                        </TabsTrigger>
                    </TabsList>

                    <DashboardTab
                        serviceInfo={serviceInfo}
                        isConnected={isConnected}
                        isLoading={isLoading}
                        metrics={metrics}
                        apiLatency={apiLatency}
                        logs={logs}
                        logLevel={logLevel}
                        isConsoleExpanded={isConsoleExpanded}
                        systemModelConfig={providersState.systemModelConfig}
                        providers={providersState.providers}
                        logsContainerRef={logsContainerRef}
                        onClearLogs={() => setLogs([])}
                        onSetLogLevel={setLogLevel}
                        onToggleConsole={() => setIsConsoleExpanded(v => !v)}
                        onSetShowSystemModelSettings={providersState.setShowSystemModelSettings}
                        onRestart={handleRestart}
                        formatUptime={formatUptime}
                        getStatusColor={getStatusColor}
                        getStatusDotColor={getStatusDotColor}
                        getStatusText={getStatusText}
                    />

                    <ModelsTab
                        localModels={localModelsState.localModels}
                        totalModelSize={localModelsState.totalModelSize}
                        isLoadingModels={localModelsState.isLoadingModels}
                        aiEngineConfig={aiEngineConfig}
                        onAddModel={() => localModelsState.setShowAddModelDialog(true)}
                        onRefresh={() => localModelsState.loadLocalModels(true)}
                        formatBytes={formatBytes}
                        getModelTypeLabel={getModelTypeLabel as never}
                    />

                    <ProvidersTab
                        providers={providersState.providers}
                        selectedProviderId={providersState.selectedProviderId}
                        selectedProvider={providersState.selectedProvider}
                        editingModelsFor={providersState.editingModelsFor}
                        newModelInput={providersState.newModelInput}
                        showApiKeys={providersState.showApiKeys}
                        onSelectProvider={providersState.setSelectedProviderId}
                        onUpdateBaseUrl={providersState.handleUpdateBaseUrl}
                        onUpdateApiKey={providersState.handleUpdateApiKey}
                        onUpdateModels={providersState.handleUpdateModels}
                        onTestConnection={providersState.handleTestConnection}
                        onDeleteProvider={providersState.handleDeleteCustomProvider}
                        onSetShowApiKeys={providersState.setShowApiKeys}
                        onSetEditingModelsFor={providersState.setEditingModelsFor}
                        onSetNewModelInput={providersState.setNewModelInput}
                        onAddCustomProvider={() => providersState.setShowAddCustomProvider(true)}
                        onShowSystemModelSettings={() => providersState.setShowSystemModelSettings(true)}
                    />

                    <SettingsTab
                        aiEngineConfig={aiEngineConfig}
                        manualPath={manualPath}
                        manualValidation={manualValidation}
                        isValidating={isValidating}
                        serviceInfo={serviceInfo}
                        onSetManualPath={setManualPath}
                        onSetManualValidation={setManualValidation}
                        onValidatePath={handleValidatePath}
                        onSaveConfig={handleSaveManualConfig}
                        onResetConfig={handleResetConfig}
                        onShowSetupWizard={() => setShowSetupWizard(true)}
                    />
                </Tabs>

                {/* 设置向导弹窗 */}
                <AIEngineSetupWizard
                    open={showSetupWizard}
                    onOpenChange={setShowSetupWizard}
                    onComplete={async () => {
                        const config = await window.api.aiEngineGetConfig()
                        setAiEngineConfig(config)
                    }}
                />

                {/* 添加模型对话框 */}
                {localModelsState.showAddModelDialog && (
                    <AddModelDialog
                        downloadableModels={localModelsState.downloadableModels}
                        downloadingModels={localModelsState.downloadingModels}
                        onDownload={localModelsState.handleDownloadModel}
                        onClose={() => localModelsState.setShowAddModelDialog(false)}
                    />
                )}

                {/* 系统模型设置弹窗 */}
                {providersState.showSystemModelSettings && (
                    <SystemModelSettingsDialog
                        providers={providersState.providers}
                        localModels={localModelsState.localModels}
                        systemModelConfig={providersState.systemModelConfig}
                        onConfigChange={providersState.setSystemModelConfig}
                        onSave={providersState.handleSaveSystemModelConfig}
                        onClose={() => providersState.setShowSystemModelSettings(false)}
                    />
                )}

                {/* 添加自定义供应商对话框 */}
                {providersState.showAddCustomProvider && (
                    <AddCustomProviderDialog
                        data={providersState.customProviderData}
                        showApiKey={!!providersState.showApiKeys['custom-temp']}
                        onDataChange={providersState.setCustomProviderData}
                        onToggleApiKey={() => providersState.setShowApiKeys(prev => ({ ...prev, 'custom-temp': !prev['custom-temp'] }))}
                        onAdd={providersState.handleAddCustomProvider}
                        onClose={() => {
                            providersState.setShowAddCustomProvider(false)
                            providersState.setCustomProviderData({ name: '', baseUrl: '', apiKey: '', models: '' })
                        }}
                    />
                )}
            </div>
        </ConfigProvider>
    )
}
