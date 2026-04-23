/**
 * AI Engine 页面共享类型定义
 */

// 日志条目类型
export interface LogEntry {
    id: number
    timestamp: Date
    level: 'info' | 'warn' | 'error' | 'debug'
    message: string
}

// 资源数据
export interface ResourceMetrics {
    cpu: number
    memory: number
    memoryPercent?: number
    gpu: number | null
    gpuMemory?: number | null
    threads?: number
    openFiles?: number
}

// 本地模型信息
export interface LocalModel {
    name: string
    type: 'embedding' | 'reranker' | 'llm' | 'whisper' | 'translation' | 'other'
    size: string
    sizeBytes: number
    files: number
    path: string
}

// 可下载模型信息
export interface DownloadableModel {
    id: string
    name: string
    local_name: string
    description: string
    size: string
    size_bytes: number
    type: string
    category: string
    downloaded: boolean
    local_path?: string
}

// AI 服务商配置
export interface AIProvider {
    id: string
    name: string
    icon: React.ReactNode
    baseUrl: string
    apiKey: string
    apiKeyUrl?: string
    status: 'connected' | 'disconnected' | 'testing' | 'error'
    models?: string[]
    capabilities: ('llm' | 'embedding' | 'rerank' | 'tts' | 'stt')[]
    isLocal?: boolean
    isCustom?: boolean
}

// 系统模型配置
export interface SystemModelConfig {
    llm: { provider: string; model: string } | null
    embedding: { provider: string; model: string } | null
    rerank: { provider: string; model: string } | null
    translation: { provider: string; model: string } | null
    tts: { provider: string; model: string } | null
    stt: { provider: string; model: string } | null
}

// AI Engine 配置
export interface AIEngineConfig {
    initialized: boolean
    setupMode: 'manual' | 'auto'
    installPath: string
    pythonPath: string
    version: string
    installedAt: string
    codeSource: 'local' | 'bundled' | 'github'
}
