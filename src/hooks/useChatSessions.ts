/**
 * MyGPT 会话存储服务
 * 使用 IndexedDB 存储会话历史
 * 同时支持从后端加载飞书等渠道的远程会话
 */

import { useState, useEffect, useCallback } from 'react'

// 来源信息类型
export interface SourceInfo {
    index: number
    fileName: string
}

// 会话消息类型
export interface ChatMessage {
    id: string
    role: 'user' | 'assistant'
    content: string
    timestamp: number
    duration?: number
    sources?: SourceInfo[]
}

// 会话类型
export interface ChatSession {
    id: string
    title: string
    messages: ChatMessage[]
    model: string
    createdAt: number
    updatedAt: number
    channel?: string        // 来源渠道: 'local' | 'feishu' 等
    channelId?: string      // 渠道内标识
    isRemote?: boolean      // 是否为远程会话（只读）
}

// 数据库配置
const DB_NAME = 'mygpt-sessions'
const DB_VERSION = 1
const STORE_NAME = 'sessions'

// 打开数据库
function openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION)

        request.onerror = () => {
            reject(new Error('Failed to open IndexedDB'))
        }

        request.onsuccess = () => {
            resolve(request.result)
        }

        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result

            // 创建会话存储
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
                store.createIndex('updatedAt', 'updatedAt', { unique: false })
                store.createIndex('createdAt', 'createdAt', { unique: false })
            }
        }
    })
}

// 获取所有会话（按更新时间降序）
async function getAllSessions(): Promise<ChatSession[]> {
    const db = await openDatabase()
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readonly')
        const store = transaction.objectStore(STORE_NAME)
        const index = store.index('updatedAt')
        const request = index.openCursor(null, 'prev')

        const sessions: ChatSession[] = []

        request.onsuccess = (event) => {
            const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result
            if (cursor) {
                sessions.push(cursor.value)
                cursor.continue()
            } else {
                resolve(sessions)
            }
        }

        request.onerror = () => {
            reject(new Error('Failed to get sessions'))
        }
    })
}

// 获取单个会话
async function getSession(id: string): Promise<ChatSession | null> {
    const db = await openDatabase()
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readonly')
        const store = transaction.objectStore(STORE_NAME)
        const request = store.get(id)

        request.onsuccess = () => {
            resolve(request.result || null)
        }

        request.onerror = () => {
            reject(new Error('Failed to get session'))
        }
    })
}

// 保存会话
async function saveSession(session: ChatSession): Promise<void> {
    const db = await openDatabase()
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite')
        const store = transaction.objectStore(STORE_NAME)
        const request = store.put(session)

        request.onsuccess = () => {
            resolve()
        }

        request.onerror = () => {
            reject(new Error('Failed to save session'))
        }
    })
}

// 删除会话
async function deleteSession(id: string): Promise<void> {
    const db = await openDatabase()
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite')
        const store = transaction.objectStore(STORE_NAME)
        const request = store.delete(id)

        request.onsuccess = () => {
            resolve()
        }

        request.onerror = () => {
            reject(new Error('Failed to delete session'))
        }
    })
}

// 创建新会话
function createNewSession(model: string): ChatSession {
    const now = Date.now()
    return {
        id: `session-${now}`,
        title: '新对话',
        messages: [],
        model,
        createdAt: now,
        updatedAt: now
    }
}

// 生成会话标题（取第一条用户消息的前 20 个字符）
function generateTitle(messages: ChatMessage[]): string {
    const firstUserMessage = messages.find((m) => m.role === 'user')
    if (firstUserMessage) {
        const content = firstUserMessage.content.trim()
        return content.length > 20 ? content.slice(0, 20) + '...' : content
    }
    return '新对话'
}

// 从后端获取远程会话（飞书等渠道）
async function fetchRemoteSessions(): Promise<ChatSession[]> {
    try {
        // 从 localStorage 获取端口信息
        const serviceInfoStr = localStorage.getItem('python-service-info')
        let port = 18888
        if (serviceInfoStr) {
            try {
                const info = JSON.parse(serviceInfoStr)
                port = info.port || 18888
            } catch { /* ignore */ }
        }

        const resp = await fetch(`http://127.0.0.1:${port}/api/sessions`)
        if (!resp.ok) return []

        const data = await resp.json()
        const remoteSessions: ChatSession[] = (data.sessions || []).map((s: any) => ({
            id: s.id,
            title: s.title || '飞书对话',
            messages: (s.messages || []).map((m: any) => ({
                id: m.id,
                role: m.role,
                content: m.content,
                timestamp: m.timestamp,
                duration: m.duration || undefined,
            })),
            model: s.model || '',
            createdAt: s.created_at,
            updatedAt: s.updated_at,
            channel: s.channel || 'feishu',
            channelId: s.channel_id || '',
            isRemote: true,
        }))

        return remoteSessions
    } catch (err) {
        console.warn('[ChatSessions] Failed to fetch remote sessions:', err)
        return []
    }
}

// 会话管理 Hook
export function useChatSessions(defaultModel: string = 'qwen3:8b') {
    const [sessions, setSessions] = useState<ChatSession[]>([])
    const [currentSession, setCurrentSession] = useState<ChatSession | null>(null)
    const [isLoading, setIsLoading] = useState(true)

    // 加载所有会话
    const loadSessions = useCallback(async () => {
        try {
            const allSessions = await getAllSessions()
            setSessions(allSessions)
            return allSessions
        } catch (error) {
            console.error('Failed to load sessions:', error)
            return []
        }
    }, [])

    // 初始化：加载会话并恢复上次会话
    useEffect(() => {
        const init = async () => {
            setIsLoading(true)
            try {
                // 并行加载本地 + 远程会话
                const [localSessions, remoteSessions] = await Promise.all([
                    loadSessions(),
                    fetchRemoteSessions(),
                ])

                // 合并并按 updatedAt 降序排列
                const allSessions = [...localSessions, ...remoteSessions]
                    .sort((a, b) => b.updatedAt - a.updatedAt)
                setSessions(allSessions)

                // 尝试恢复上次会话
                const lastSessionId = localStorage.getItem('mygpt-last-session-id')
                if (lastSessionId) {
                    const lastSession = allSessions.find((s) => s.id === lastSessionId)
                    if (lastSession) {
                        setCurrentSession(lastSession)
                        setIsLoading(false)
                        return
                    }
                }

                // 如果没有上次会话，使用最新的会话或创建新会话
                if (allSessions.length > 0) {
                    setCurrentSession(allSessions[0])
                } else {
                    const newSession = createNewSession(defaultModel)
                    await saveSession(newSession)
                    setCurrentSession(newSession)
                    setSessions([newSession])
                }
            } catch (error) {
                console.error('Failed to initialize sessions:', error)
                // 出错时创建一个临时会话
                const newSession = createNewSession(defaultModel)
                setCurrentSession(newSession)
            } finally {
                setIsLoading(false)
            }
        }

        init()
    }, [defaultModel, loadSessions])

    // 保存当前会话 ID 到 localStorage
    useEffect(() => {
        if (currentSession) {
            localStorage.setItem('mygpt-last-session-id', currentSession.id)
        }
    }, [currentSession?.id])

    // 创建新会话
    const createSession = useCallback(
        async (model?: string) => {
            const newSession = createNewSession(model || currentSession?.model || defaultModel)
            await saveSession(newSession)
            setCurrentSession(newSession)
            setSessions((prev) => [newSession, ...prev])
            return newSession
        },
        [currentSession?.model, defaultModel]
    )

    // 切换会话
    const switchSession = useCallback(async (sessionId: string) => {
        // 先尝试从本地 IndexedDB 加载
        const session = await getSession(sessionId)
        if (session) {
            setCurrentSession(session)
            return
        }
        // 如果本地没有（远程会话），从 sessions state 中查找
        const remoteSession = sessions.find(s => s.id === sessionId)
        if (remoteSession) {
            setCurrentSession(remoteSession)
        }
    }, [sessions])

    // 更新当前会话的消息
    const updateMessages = useCallback(
        async (messages: ChatMessage[]) => {
            if (!currentSession) return

            const updatedSession: ChatSession = {
                ...currentSession,
                messages,
                title:
                    currentSession.title === '新对话' && messages.length > 0
                        ? generateTitle(messages)
                        : currentSession.title,
                updatedAt: Date.now()
            }

            await saveSession(updatedSession)
            setCurrentSession(updatedSession)
            setSessions((prev) =>
                prev.map((s) => (s.id === updatedSession.id ? updatedSession : s))
            )
        },
        [currentSession]
    )

    // 删除会话
    const removeSession = useCallback(
        async (sessionId: string) => {
            // 判断是否远程会话
            const targetSession = sessions.find(s => s.id === sessionId)
            if (targetSession?.isRemote) {
                // 远程会话：调后端 API 删除
                try {
                    const serviceInfoStr = localStorage.getItem('python-service-info')
                    let port = 18888
                    if (serviceInfoStr) {
                        try {
                            const info = JSON.parse(serviceInfoStr)
                            port = info.port || 18888
                        } catch { /* ignore */ }
                    }
                    await fetch(`http://127.0.0.1:${port}/api/sessions/${sessionId}`, { method: 'DELETE' })
                } catch (err) {
                    console.error('Failed to delete remote session:', err)
                }
            } else {
                // 本地会话：从 IndexedDB 删除
                await deleteSession(sessionId)
            }

            setSessions((prev) => prev.filter((s) => s.id !== sessionId))

            // 如果删除的是当前会话，切换到其他会话或创建新会话
            if (currentSession?.id === sessionId) {
                const remainingSessions = sessions.filter((s) => s.id !== sessionId)
                if (remainingSessions.length > 0) {
                    setCurrentSession(remainingSessions[0])
                } else {
                    const newSession = createNewSession(defaultModel)
                    await saveSession(newSession)
                    setCurrentSession(newSession)
                    setSessions([newSession])
                }
            }
        },
        [currentSession?.id, sessions, defaultModel]
    )

    // 更新会话模型
    const updateSessionModel = useCallback(
        async (model: string) => {
            if (!currentSession) return

            const updatedSession: ChatSession = {
                ...currentSession,
                model,
                updatedAt: Date.now()
            }

            await saveSession(updatedSession)
            setCurrentSession(updatedSession)
            setSessions((prev) =>
                prev.map((s) => (s.id === updatedSession.id ? updatedSession : s))
            )
        },
        [currentSession]
    )

    return {
        sessions,
        currentSession,
        isLoading,
        createSession,
        switchSession,
        updateMessages,
        removeSession,
        updateSessionModel,
        loadSessions
    }
}
