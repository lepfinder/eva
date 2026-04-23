/**
 * 多知识库管理 Hook
 * 支持 Obsidian、PDF、代码仓库等多种类型
 * 数据存储在主进程 JSON 文件中，开发和打包后共享
 */

import { useState, useEffect, useCallback } from 'react'

// 知识库类型
export type KnowledgeBaseType = 'obsidian' | 'pdf' | 'code'

// 知识库状态
export type KnowledgeBaseStatus = 'not_indexed' | 'indexing' | 'indexed' | 'error'

// 知识库接口定义
export interface KnowledgeBase {
    id: string              // UUID
    name: string            // 显示名称
    type: KnowledgeBaseType // 类型
    path: string            // 本地路径
    collectionName: string  // ChromaDB collection 名称
    lastIndexedAt: number | null  // 最后索引时间
    docCount: number        // 文档数量
    enabled: boolean        // 是否默认启用
    status: KnowledgeBaseStatus  // 当前状态
    errorMessage?: string   // 错误信息
    excludePaths?: string[] // 排除的目录路径列表
}

// 知识库类型信息
export const KB_TYPE_INFO: Record<KnowledgeBaseType, {
    label: string
    icon: string
    description: string
    fileTypes: string[]
}> = {
    obsidian: {
        label: 'Obsidian 笔记库',
        icon: '📝',
        description: '支持 Markdown 文件，适合个人知识管理',
        fileTypes: ['.md']
    },
    pdf: {
        label: 'PDF 文档库',
        icon: '📄',
        description: '支持 PDF 文件，适合论文、合同等',
        fileTypes: ['.pdf']
    },
    code: {
        label: '代码仓库',
        icon: '💻',
        description: '支持代码文件，适合技术文档和源码',
        fileTypes: ['.js', '.ts', '.py', '.go', '.java', '.md']
    }
}

const PYTHON_SERVICE_URL = 'http://127.0.0.1:18888'

// 生成 UUID
function generateId(): string {
    return `kb-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

export function useKnowledgeBases() {
    const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([])
    const [loading, setLoading] = useState(true)

    // 从主进程加载知识库列表
    const loadKnowledgeBases = useCallback(async () => {
        try {
            const kbs = await window.api.knowledgeBaseGetAll()
            setKnowledgeBases(kbs || [])
        } catch (e) {
            console.error('Failed to load knowledge bases:', e)
        } finally {
            setLoading(false)
        }
    }, [])

    // 初始加载
    useEffect(() => {
        loadKnowledgeBases()
    }, [loadKnowledgeBases])

    // 添加知识库
    const addKnowledgeBase = useCallback(async (
        name: string,
        type: KnowledgeBaseType,
        path: string,
        excludePaths?: string[]
    ): Promise<KnowledgeBase> => {
        const id = generateId()
        const newKB: KnowledgeBase = {
            id,
            name,
            type,
            path,
            collectionName: id, // 使用 ID 作为 collection 名称
            lastIndexedAt: null,
            docCount: 0,
            enabled: true,
            status: 'not_indexed',
            excludePaths: excludePaths || []
        }

        // 保存到主进程
        await window.api.knowledgeBaseAdd(newKB)
        setKnowledgeBases(prev => [...prev, newKB])

        return newKB
    }, [])

    // 更新知识库
    const updateKnowledgeBase = useCallback(async (
        id: string,
        updates: Partial<KnowledgeBase>
    ) => {
        // 保存到主进程
        await window.api.knowledgeBaseUpdate(id, updates)
        setKnowledgeBases(prev =>
            prev.map(kb => kb.id === id ? { ...kb, ...updates } : kb)
        )
    }, [])

    // 删除知识库
    const deleteKnowledgeBase = useCallback(async (id: string) => {
        // 先调用后端删除索引
        try {
            await fetch(`${PYTHON_SERVICE_URL}/api/rag/delete`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ kb_id: id })
            })
        } catch (e) {
            console.error('Failed to delete index:', e)
        }

        // 从主进程删除
        await window.api.knowledgeBaseDelete(id)
        setKnowledgeBases(prev => prev.filter(kb => kb.id !== id))
    }, [])

    // 构建索引
    const buildIndex = useCallback(async (id: string): Promise<boolean> => {
        const kb = knowledgeBases.find(k => k.id === id)
        if (!kb) return false

        // 更新状态为索引中
        await updateKnowledgeBase(id, { status: 'indexing' })

        try {
            const response = await fetch(`${PYTHON_SERVICE_URL}/api/rag/build`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    kb_id: kb.id,
                    type: kb.type,
                    path: kb.path,
                    collection_name: kb.collectionName,
                    exclude_paths: kb.excludePaths || []
                })
            })

            const result = await response.json()

            if (result.success) {
                await updateKnowledgeBase(id, {
                    status: 'indexed',
                    lastIndexedAt: Date.now(),
                    docCount: result.doc_count || 0,
                    errorMessage: undefined
                })
                return true
            } else {
                await updateKnowledgeBase(id, {
                    status: 'error',
                    errorMessage: result.error || '索引构建失败'
                })
                return false
            }
        } catch (e) {
            await updateKnowledgeBase(id, {
                status: 'error',
                errorMessage: e instanceof Error ? e.message : '网络错误'
            })
            return false
        }
    }, [knowledgeBases, updateKnowledgeBase])

    // 切换启用状态
    const toggleEnabled = useCallback(async (id: string) => {
        const kb = knowledgeBases.find(k => k.id === id)
        if (kb) {
            await updateKnowledgeBase(id, { enabled: !kb.enabled })
        }
    }, [knowledgeBases, updateKnowledgeBase])

    // 获取已启用的知识库
    const enabledKnowledgeBases = knowledgeBases.filter(kb => kb.enabled && kb.status === 'indexed')

    // 获取已索引的知识库
    const indexedKnowledgeBases = knowledgeBases.filter(kb => kb.status === 'indexed')

    return {
        knowledgeBases,
        enabledKnowledgeBases,
        indexedKnowledgeBases,
        loading,
        addKnowledgeBase,
        updateKnowledgeBase,
        deleteKnowledgeBase,
        buildIndex,
        toggleEnabled,
        reload: loadKnowledgeBases
    }
}
