import { useState, useEffect, useCallback } from 'react'
import { message } from 'antd'
import type { LocalModel, DownloadableModel } from '../types'

interface UseLocalModelsReturn {
    localModels: LocalModel[]
    isLoadingModels: boolean
    totalModelSize: number
    downloadableModels: DownloadableModel[]
    downloadingModels: Record<string, { progress: number; status: string }>
    showAddModelDialog: boolean
    setShowAddModelDialog: (v: boolean) => void
    loadLocalModels: (isManual?: boolean) => Promise<void>
    handleDownloadModel: (modelId: string) => Promise<void>
}

export function useLocalModels(): UseLocalModelsReturn {
    const [messageApi, contextHolder] = message.useMessage()
    const [localModels, setLocalModels] = useState<LocalModel[]>([])
    const [isLoadingModels, setIsLoadingModels] = useState(false)
    const [totalModelSize, setTotalModelSize] = useState(0)
    const [downloadableModels, setDownloadableModels] = useState<DownloadableModel[]>([])
    const [downloadingModels, setDownloadingModels] = useState<Record<string, { progress: number; status: string }>>({})
    const [showAddModelDialog, setShowAddModelDialog] = useState(false)

    const loadLocalModels = useCallback(async (isManual = false) => {
        setIsLoadingModels(true)
        let hide: ReturnType<typeof messageApi.loading> | null = null
        if (isManual) {
            hide = messageApi.loading('正在加载模型列表...', 0)
        }

        try {
            const response = await fetch('http://127.0.0.1:18888/models/downloadable')
            if (!response.ok) {
                throw new Error('Failed to fetch models')
            }
            const data = await response.json()
            const allModels: DownloadableModel[] = data.models || []
            const downloadedModels = allModels.filter(m => m.downloaded)
            const models: LocalModel[] = downloadedModels.map(m => ({
                name: m.local_name,
                type: m.type as LocalModel['type'],
                size: m.size,
                sizeBytes: m.size_bytes,
                files: 0,
                path: m.local_path || ''
            }))
            setLocalModels(models)
            setDownloadableModels(allModels)
            setTotalModelSize(models.reduce((sum, m) => sum + (m.sizeBytes || 0), 0))
            if (isManual) messageApi.success(`已加载 ${models.length} 个本地模型`)
        } catch (error) {
            console.error('Failed to load models:', error)
            try {
                const models = await window.api.aiEngineListLocalModels()
                setLocalModels(models)
                setTotalModelSize(models.reduce((sum, m) => sum + (m.sizeBytes || 0), 0))
                if (isManual) messageApi.success(`已发现 ${models.length} 个本地模型`)
            } catch {
                setLocalModels([])
                setTotalModelSize(0)
                if (isManual) messageApi.error('加载模型列表失败')
            }
        } finally {
            if (hide) hide()
            setIsLoadingModels(false)
        }
    }, [messageApi])

    useEffect(() => {
        loadLocalModels(false)
    }, [loadLocalModels])

    useEffect(() => {
        if (showAddModelDialog) {
            loadLocalModels(false)
        }
    }, [showAddModelDialog, loadLocalModels])

    const handleDownloadModel = useCallback(async (modelId: string) => {
        try {
            setDownloadingModels(prev => ({
                ...prev,
                [modelId]: { progress: 0, status: 'starting' }
            }))

            const response = await fetch('http://127.0.0.1:18888/models/download', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model_id: modelId })
            })

            if (!response.ok) throw new Error('Download request failed')
            const data = await response.json()

            if (data.status === 'exists') {
                messageApi.info(data.message)
                setDownloadingModels(prev => {
                    const next = { ...prev }
                    delete next[modelId]
                    return next
                })
                return
            }

            messageApi.info(`开始下载: ${modelId.split('/').pop()}`)

            const pollStatus = async () => {
                try {
                    const statusResponse = await fetch(`http://127.0.0.1:18888/models/download/status/${encodeURIComponent(modelId)}`)
                    if (statusResponse.ok) {
                        const status = await statusResponse.json()
                        setDownloadingModels(prev => ({
                            ...prev,
                            [modelId]: { progress: status.progress, status: status.status }
                        }))
                        if (status.status === 'completed') {
                            messageApi.success(`模型下载完成: ${modelId.split('/').pop()}`)
                            setDownloadingModels(prev => {
                                const next = { ...prev }
                                delete next[modelId]
                                return next
                            })
                            loadLocalModels(false)
                            return
                        }
                        if (status.status === 'failed') {
                            messageApi.error(`下载失败: ${status.error || status.message}`)
                            setDownloadingModels(prev => {
                                const next = { ...prev }
                                delete next[modelId]
                                return next
                            })
                            return
                        }
                        setTimeout(pollStatus, 2000)
                    }
                } catch {
                    setTimeout(pollStatus, 3000)
                }
            }
            setTimeout(pollStatus, 1000)
        } catch (error) {
            console.error('Failed to download model:', error)
            messageApi.error('下载模型失败')
            setDownloadingModels(prev => {
                const next = { ...prev }
                delete next[modelId]
                return next
            })
        }
    }, [messageApi, loadLocalModels])

    // 注意：contextHolder 需要在外层 ConfigProvider 内渲染，由调用方处理
    void contextHolder

    return {
        localModels,
        isLoadingModels,
        totalModelSize,
        downloadableModels,
        downloadingModels,
        showAddModelDialog,
        setShowAddModelDialog,
        loadLocalModels,
        handleDownloadModel
    }
}
