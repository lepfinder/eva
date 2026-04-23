/**
 * AI Engine 服务管理 Hook
 * 用于检查健康状态、管理服务生命周期
 */

import { useState, useEffect, useCallback } from 'react'

// 默认端口，在获取到 serviceInfo 前使用
let CURRENT_SERVICE_PORT = 18888
const getServiceUrlBase = (port?: number) => `http://127.0.0.1:${port || CURRENT_SERVICE_PORT}`

export interface PythonServiceHealth {
    status: 'ok' | 'error'
    ollama_available: boolean
    version: string
}

export interface PythonServiceInfo {
    status: 'stopped' | 'starting' | 'running' | 'error'
    pid: number | null
    port: number
    uptime: number | null
    lastError: string | null
    pythonPath?: string
    servicePath?: string
}

export interface ModelInfo {
    name: string
    size?: number
    modified_at?: string
}

export interface UsePythonServiceReturn {
    // 状态
    isConnected: boolean
    isOllamaAvailable: boolean
    isLoading: boolean
    error: string | null
    serviceInfo: PythonServiceInfo | null
    models: ModelInfo[]

    // 操作
    checkHealth: () => Promise<boolean>
    startService: () => Promise<boolean>
    stopService: () => Promise<boolean>
    restartService: () => Promise<boolean>
    fetchModels: () => Promise<ModelInfo[]>
    updateServiceConfig: (config: { port?: number; autoStart?: boolean; servicePath?: string }) => Promise<boolean>
    getServiceUrl: () => string
}

export function usePythonService(): UsePythonServiceReturn {
    const [isConnected, setIsConnected] = useState(false)
    const [isOllamaAvailable, setIsOllamaAvailable] = useState(false)
    const [isLoading, setIsLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [serviceInfo, setServiceInfo] = useState<PythonServiceInfo | null>(null)
    const [models, setModels] = useState<ModelInfo[]>([])

    /**
     * 检查健康状态
     */
    const checkHealth = useCallback(async (): Promise<boolean> => {
        try {
            console.log('[usePythonService] Checking health...')
            const url = `${getServiceUrlBase(serviceInfo?.port)}/health`
            const response = await fetch(url, {
                method: 'GET',
                headers: { 'Accept': 'application/json' },
                mode: 'cors'
            })

            console.log('[usePythonService] Health response:', response.status)

            if (response.ok) {
                const data: PythonServiceHealth = await response.json()
                console.log('[usePythonService] Health data:', data)
                setIsConnected(true)
                setIsOllamaAvailable(data.ollama_available)
                setError(null)
                return true
            } else {
                setIsConnected(false)
                setIsOllamaAvailable(false)
                setError(`Service returned status ${response.status}`)
                return false
            }
        } catch (err) {
            console.error('[usePythonService] Health check failed:', err)
            setIsConnected(false)
            setIsOllamaAvailable(false)
            setError('Cannot connect to Python service')
            return false
        }
    }, [serviceInfo?.port])

    /**
     * 获取 Electron 管理的服务信息
     */
    const fetchServiceInfo = useCallback(async () => {
        try {
            const info = await window.api.pythonGetInfo()
            if (info) {
                setServiceInfo(info as PythonServiceInfo)
                CURRENT_SERVICE_PORT = (info as PythonServiceInfo).port
            }
        } catch (err) {
            console.error('Failed to get service info:', err)
        }
    }, [])

    /**
     * 启动服务
     */
    const startService = useCallback(async (): Promise<boolean> => {
        setIsLoading(true)
        setError(null)
        try {
            const success = await window.api.pythonStart()
            if (success) {
                // 等待服务就绪
                await new Promise(resolve => setTimeout(resolve, 2000))
                await checkHealth()
                await fetchServiceInfo()
            }
            return success
        } catch (err) {
            setError((err as Error).message)
            return false
        } finally {
            setIsLoading(false)
        }
    }, [checkHealth, fetchServiceInfo])

    /**
     * 停止服务
     */
    const stopService = useCallback(async (): Promise<boolean> => {
        setIsLoading(true)
        try {
            const success = await window.api.pythonStop()
            setIsConnected(false)
            setIsOllamaAvailable(false)
            await fetchServiceInfo()
            return success
        } catch (err) {
            setError((err as Error).message)
            return false
        } finally {
            setIsLoading(false)
        }
    }, [fetchServiceInfo])

    /**
     * 重启服务
     */
    const restartService = useCallback(async (): Promise<boolean> => {
        setIsLoading(true)
        setError(null)
        try {
            const success = await window.api.pythonRestart()
            if (success) {
                await new Promise(resolve => setTimeout(resolve, 2000))
                await checkHealth()
                await fetchServiceInfo()
            }
            return success
        } catch (err) {
            setError((err as Error).message)
            return false
        } finally {
            setIsLoading(false)
        }
    }, [checkHealth, fetchServiceInfo])

    /**
     * 获取可用模型列表
     */
    const fetchModels = useCallback(async (): Promise<ModelInfo[]> => {
        try {
            const url = `${getServiceUrlBase(serviceInfo?.port)}/models`
            const response = await fetch(url, {
                method: 'GET',
                headers: { 'Accept': 'application/json' }
            })

            if (response.ok) {
                const data = await response.json()
                const modelList = data.models || []
                setModels(modelList)
                return modelList
            }
            return []
        } catch (err) {
            console.error('Failed to fetch models:', err)
            return []
        }
    }, [serviceInfo?.port])

    /**
     * 更新服务配置
     */
    const updateServiceConfig = useCallback(async (config: { port?: number; autoStart?: boolean; servicePath?: string }) => {
        const success = await window.api.pythonUpdateConfig(config)
        if (success) {
            await fetchServiceInfo()
        }
        return success
    }, [fetchServiceInfo])

    /**
     * 获取服务 URL
     */
    const getServiceUrl = useCallback((): string => {
        return getServiceUrlBase(serviceInfo?.port)
    }, [serviceInfo?.port])

    // 初始化：检查健康状态并启动轮询
    useEffect(() => {
        let isMounted = true

        const checkServiceHealth = async () => {
            // 如果页面不可见，跳过此轮检查（减少系统资源占用）
            if (document.visibilityState !== 'visible') return
            await checkHealth()
            // 注意：轮询不再获取模型列表，以减少对 Ollama 的请求压力
        }

        // 初次加载获取服务信息并执行一次完整检查（包含模型列表）
        const init = async () => {
            setIsLoading(true)
            await fetchServiceInfo()
            const connected = await checkHealth()
            if (connected && isMounted) {
                await fetchModels()
            }
            if (isMounted) setIsLoading(false)
        }

        init()

        // 统一 10 秒轮询
        const interval = setInterval(checkServiceHealth, 10000)

        return () => {
            isMounted = false
            clearInterval(interval)
        }
    }, [checkHealth, fetchServiceInfo, fetchModels])

    return {
        isConnected,
        isOllamaAvailable,
        isLoading,
        error,
        serviceInfo,
        models,
        checkHealth,
        startService,
        stopService,
        restartService,
        fetchModels,
        updateServiceConfig,
        getServiceUrl
    }
}

// ==================== 聊天 API ====================

export interface ChatMessage {
    role: 'user' | 'assistant' | 'system'
    content: string
}

export interface ChatStreamCallbacks {
    onToken?: (token: string) => void
    onComplete?: (fullContent: string) => void
    onError?: (error: string) => void
}

/**
 * 发送聊天消息并处理流式响应
 */
export async function sendChatMessage(
    message: string,
    options: {
        model?: string
        history?: ChatMessage[]
        systemPrompt?: string
    } = {},
    callbacks: ChatStreamCallbacks = {}
): Promise<string> {
    const { model = 'qwen3:1.7b', history = [], systemPrompt } = options
    const { onToken, onComplete, onError } = callbacks

    let fullContent = ''

    try {
        const url = `${getServiceUrlBase()}/chat`
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'text/event-stream'
            },
            body: JSON.stringify({
                message,
                model,
                history,
                system_prompt: systemPrompt
            })
        })

        if (!response.ok) {
            const errorText = await response.text()
            throw new Error(`HTTP ${response.status}: ${errorText}`)
        }

        const reader = response.body?.getReader()
        if (!reader) {
            throw new Error('Response body is not readable')
        }

        const decoder = new TextDecoder()

        while (true) {
            const { done, value } = await reader.read()
            if (done) break

            const text = decoder.decode(value, { stream: true })

            // 解析 SSE 格式: data: {...}\n\n
            const lines = text.split('\n')
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    try {
                        const jsonStr = line.slice(6) // 移除 "data: " 前缀
                        const data = JSON.parse(jsonStr)

                        if (data.error) {
                            onError?.(data.error)
                            throw new Error(data.error)
                        }

                        if (data.content) {
                            fullContent += data.content
                            onToken?.(data.content)
                        }

                        if (data.done) {
                            onComplete?.(fullContent)
                        }
                    } catch (parseErr) {
                        // 忽略解析错误（可能是不完整的 JSON）
                        if (line.trim() && !line.includes('"done":')) {
                            console.warn('Failed to parse SSE line:', line)
                        }
                    }
                }
            }
        }

        return fullContent
    } catch (err) {
        const errorMessage = (err as Error).message
        onError?.(errorMessage)
        throw err
    }
}
