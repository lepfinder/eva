/**
 * MyGPT 聊天页面 - 混合使用 Ant Design X 和 shadcn/ui
 * 工具栏使用 shadcn/ui 保持一致性
 * 对话区域使用 Ant Design X 的 Bubble 组件
 */

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { Bubble, Sender, XProvider } from '@ant-design/x'
import { ConfigProvider, Alert, Switch } from 'antd'
import {
    Bot,
    User,
    RefreshCw,
    Trash2,
    Loader2,
    Settings,
    Plus,
    History as HistoryIcon,
    MessageSquare,
    BookOpen,
    Pencil
} from 'lucide-react'

import { useChatSessions, ChatMessage as SessionMessage, SourceInfo } from '@/hooks/useChatSessions'
import { usePythonService } from '@/hooks/usePythonService'
import { useKnowledgeBases, KnowledgeBaseType } from '@/hooks/useKnowledgeBases'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'

import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
    TooltipProvider
} from '@/components/ui/tooltip'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
} from '@/components/ui/dialog'
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle
} from '@/components/ui/sheet'
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

// 导入 Ant Design X 样式
import '@/styles/antdx.css'

import {
    loadProviderConfig,
    extractSources,
    ProviderConfig
} from '../lib/chat-utils'
import { useAIProviders } from '@/hooks/useAIProviders'
import { ModelSelector } from '@/components/common/ModelSelector'
import {
    MessageContent,
    CopyButton,
    TTSButton
} from '../components/chat/MessageComponents'
import { KnowledgeBaseSettings } from '../components/chat/KnowledgeBaseSettings'

// Ant Design X 主题配置（继承系统主题）
const antdTheme = {
    token: {
        colorPrimary: '#3b82f6',
        borderRadius: 8
    }
}





interface Message {
    id: string
    role: 'user' | 'assistant'
    content: string
    timestamp: number // 对应后端存储的 timestamp
    isStreaming?: boolean
    duration?: number
    sources?: SourceInfo[]
}


/**
 * 格式化聊天时间 (微信风格)
 */
function formatChatTime(timestamp: number): string {
    const date = new Date(timestamp)
    const now = new Date()
    const isToday = date.toDateString() === now.toDateString()

    // 检查是否是昨天
    const yesterday = new Date(now)
    yesterday.setDate(now.getDate() - 1)
    const isYesterday = date.toDateString() === yesterday.toDateString()

    const hours = String(date.getHours()).padStart(2, '0')
    const minutes = String(date.getMinutes()).padStart(2, '0')
    const timeStr = `${hours}:${minutes}`

    if (isToday) return timeStr
    if (isYesterday) return `昨天 ${timeStr}`

    // 如果是同一年
    if (date.getFullYear() === now.getFullYear()) {
        return `${date.getMonth() + 1}月${date.getDate()}日 ${timeStr}`
    }

    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${timeStr}`
}

export function MyGPTPage(): React.ReactElement {
    const {
        isConnected,
        isOllamaAvailable,
        isLoading: serviceLoading,
        error: serviceError,
        models,
        startService,
        fetchModels,
        getServiceUrl
    } = usePythonService()

    // 知识库管理
    const {
        indexedKnowledgeBases,
        knowledgeBases,
        addKnowledgeBase,
        deleteKnowledgeBase,
        buildIndex
    } = useKnowledgeBases()



    // 包装 addKnowledgeBase 以匹配 Promise<void> 签名
    const handleAddKB = async (name: string, type: KnowledgeBaseType, path: string, excludePaths?: string[]) => {
        await addKnowledgeBase(name, type, path, excludePaths)
    }

    // 构建索引 - 需要返回 boolean
    const handleBuildIndex = async (id: string) => {
        return await buildIndex(id)
    }

    // 删除知识库
    const handleDeleteKB = async (id: string) => {
        if (confirm('确定要删除这个知识库吗？索引数据也会被删除。')) {
            await deleteKnowledgeBase(id)
        }
    }
    const [selectedKBIds, setSelectedKBIds] = useState<string[]>([])

    // 自动选中 Obsidian 知识库作为默认值
    useEffect(() => {
        if (indexedKnowledgeBases.length > 0 && selectedKBIds.length === 0) {
            const obsidianIds = indexedKnowledgeBases
                .filter(kb => kb.type === 'obsidian')
                .map(kb => kb.id)
            if (obsidianIds.length > 0) {
                setSelectedKBIds(obsidianIds)
            }
        }
    }, [indexedKnowledgeBases])

    // 供应商配置
    const [providerConfig] = useState<ProviderConfig>(loadProviderConfig)
    const defaultModel = providerConfig.defaultModel || 'qwen3-coder:30b'

    // 会话管理
    const {
        sessions,
        currentSession,
        isLoading: _sessionsLoading,
        createSession,
        switchSession,
        updateMessages,
        removeSession,
        updateSessionModel
    } = useChatSessions(defaultModel)
    void _sessionsLoading // 可用于显示加载状态

    // RAG 开关状态
    const [isRAGEnabled, setIsRAGEnabled] = useState(true)

    const [inputValue, setInputValue] = useState('')
    const [isGenerating, setIsGenerating] = useState(false)
    const [selectedModel, setSelectedModel] = useState(defaultModel)
    const [systemPrompt] = useState('你是一个有帮助的 AI 助手。')
    const [historySheetOpen, setHistorySheetOpen] = useState(false)

    // 使用通用 Hook 加载所有供应商及其模型
    const { providers: aiProviders, parseModelValue } = useAIProviders({ onlyConnected: true })

    // 配置弹窗
    const [configDialogOpen, setConfigDialogOpen] = useState(false)


    // 当前会话的消息
    const messages: Message[] = (currentSession?.messages || []).map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
        duration: m.duration,
        sources: m.sources
    }))

    const scrollAreaRef = useRef<HTMLDivElement>(null)
    const abortControllerRef = useRef<AbortController | null>(null)

    const scrollToBottom = useCallback(() => {
        if (scrollAreaRef.current) {
            scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight
        }
    }, [])

    useEffect(() => {
        scrollToBottom()
    }, [currentSession?.messages, scrollToBottom])

    // 同步会话模型到选择器
    useEffect(() => {
        if (currentSession?.model) {
            setSelectedModel(currentSession.model)
        }
    }, [currentSession?.model])

    // 当选择模型变化时更新会话
    const handleModelChange = useCallback(
        (model: string) => {
            setSelectedModel(model)
            updateSessionModel(model)
        },
        [updateSessionModel]
    )

    useEffect(() => {
        // 检查选中模型是否有效（Ollama 模型或第三方供应商模型）
        const isOllamaModel = models.find((m) => m.name === selectedModel)
        const isProviderModel = selectedModel.includes(':') && aiProviders.some(p => selectedModel.startsWith(`${p.id}:`))

        // 只有当选中模型既不是 Ollama 模型也不是第三方供应商模型时才重置
        if (models.length > 0 && !isOllamaModel && !isProviderModel) {
            const newModel = models[0].name
            setSelectedModel(newModel)
            updateSessionModel(newModel)
        }
    }, [models, selectedModel, updateSessionModel, aiProviders])


    const handleSend = useCallback(
        async (text?: string) => {
            const messageText = text || inputValue
            if (!messageText.trim() || isGenerating || !isConnected || !currentSession) return

            const userMessage: SessionMessage = {
                id: Date.now().toString(),
                role: 'user',
                content: messageText.trim(),
                timestamp: Date.now()
            }

            // 添加用户消息
            const messagesWithUser = [...(currentSession.messages || []), userMessage]
            await updateMessages(messagesWithUser)
            setInputValue('')
            setIsGenerating(true)

            const assistantMessage: SessionMessage = {
                id: (Date.now() + 1).toString(),
                role: 'assistant',
                content: '',
                timestamp: Date.now()
            }

            // 添加 AI 消息（空内容，等待流式填充）
            const messagesWithAssistant = [...messagesWithUser, assistantMessage]
            await updateMessages(messagesWithAssistant)


            abortControllerRef.current = new AbortController()

            try {
                // 使用通用 parseModelValue 解析复合模型值
                const parsed = parseModelValue(selectedModel)
                const actualModel = parsed.actualModel
                const provider = parsed.isOllama
                    ? {
                          type: providerConfig.type as string,
                          api_base: providerConfig.apiBase,
                          api_key: providerConfig.apiKey
                      }
                    : {
                          type: 'openai' as string,
                          api_base: parsed.baseUrl,
                          api_key: parsed.apiKey?.trim()
                      }

                console.log(`[MyGPT] Sending: model=${actualModel}, provider=${provider.type}, base=${provider.api_base}`)

                // 构建历史消息列表
                const history = (currentSession.messages || [])
                    .filter(m => m.content && m.content.trim() !== '') // 过滤空消息
                    .map((m) => ({
                        role: m.role,
                        content: m.content
                    }))

                const response = await fetch(`${getServiceUrl()}/chat`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Accept: 'text/event-stream'
                    },
                    body: JSON.stringify({
                        message: userMessage.content,
                        model: actualModel,
                        history,
                        system_prompt: systemPrompt,
                        provider,
                        kb_ids: (isRAGEnabled && selectedKBIds.length > 0) ? selectedKBIds : undefined,
                        use_rag: isRAGEnabled && selectedKBIds.length > 0
                    }),
                    signal: abortControllerRef.current.signal
                })

                const startTime = Date.now()

                if (!response.ok) throw new Error(`HTTP ${response.status}`)

                const reader = response.body?.getReader()
                if (!reader) throw new Error('No reader')

                const decoder = new TextDecoder()
                let fullContent = ''
                let receivedSources: SourceInfo[] | undefined = undefined // 用于累积接收到的 sources

                while (true) {
                    const { done, value } = await reader.read()
                    if (done) break

                    const text = decoder.decode(value, { stream: true })
                    const lines = text.split('\n')

                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            try {
                                const data = JSON.parse(line.slice(6))
                                if (data.error) {
                                    const errorMessages = [...messagesWithUser, {
                                        ...assistantMessage,
                                        content: `错误: ${data.error}`
                                    }]
                                    await updateMessages(errorMessages as SessionMessage[])
                                    return
                                }

                                // 更新内容
                                const newContent = data.content || ''
                                fullContent += newContent

                                // 更新结构化来源 (如果后端提供了)
                                if (data.sources && data.sources.length > 0) {
                                    receivedSources = data.sources
                                }

                                // 构建更新后的 AI 消息对象
                                const updatedAssistantMsg: SessionMessage = {
                                    ...assistantMessage,
                                    content: fullContent,
                                    sources: receivedSources
                                }

                                const updatedMessages = [...messagesWithUser, updatedAssistantMsg]
                                await updateMessages(updatedMessages)

                            } catch {
                                // ignore
                            }
                        }
                    }
                }

                // 计算耗时并更新最后一条消息
                const duration = (Date.now() - startTime) / 1000

                // 最终消息，确保 sources 已经就绪
                // 优先使用流式过程中接收到的 sources，否则尝试从文本提取
                const finalSources = receivedSources || extractSources(fullContent)

                // 构建符合 SessionMessage (ChatMessage) 类型的对象
                const finalAssistantMsg: SessionMessage = {
                    ...assistantMessage,
                    content: fullContent,
                    duration,
                    sources: finalSources,
                    timestamp: Date.now()
                }

                const finalMessages = [...messagesWithUser, finalAssistantMsg]
                await updateMessages(finalMessages)
            } catch (err) {
                if ((err as Error).name !== 'AbortError') {
                    const errorMessages = [...messagesWithUser, {
                        ...assistantMessage,
                        content: `连接错误: ${(err as Error).message}`
                    }]
                    await updateMessages(errorMessages as SessionMessage[])
                }
            } finally {
                setIsGenerating(false)
            }
        },
        [
            inputValue,
            isGenerating,
            isConnected,
            currentSession,
            selectedModel,
            providerConfig,
            aiProviders,
            systemPrompt,
            isRAGEnabled,
            selectedKBIds,
            getServiceUrl,
            updateMessages
        ]
    )

    // 新建会话
    const handleNewSession = useCallback(async () => {
        abortControllerRef.current?.abort()
        await createSession(selectedModel)
        setHistorySheetOpen(false)
    }, [createSession, selectedModel])

    const handleCancel = useCallback(() => {
        abortControllerRef.current?.abort()
        setIsGenerating(false)
    }, [])

    // Bubble.List 配置 (插入时间标签)
    const bubbleItems = useMemo(() => {
        const items: any[] = []
        const TIME_GAP = 5 * 60 * 1000 // 5分钟间隔

        messages.forEach((msg, index) => {
            const prevMsg = index > 0 ? messages[index - 1] : null

            // 如果是第一条消息，或者与上一条消息间隔超过 5 分钟，插入时间标签
            if (!prevMsg || (msg.timestamp - prevMsg.timestamp > TIME_GAP)) {
                items.push({
                    key: `time-${msg.timestamp}-${index}`,
                    role: 'label',
                    content: (
                        <div className="flex justify-center w-full my-4">
                            <span className="px-3 py-1 text-[12px] font-medium rounded-full bg-zinc-400/10 dark:bg-zinc-500/15 text-zinc-400/80 dark:text-zinc-500/80 select-none">
                                {formatChatTime(msg.timestamp)}
                            </span>
                        </div>
                    )
                })
            }

            const isLastMessage = index === messages.length - 1
            const isEmptyAIMessage = msg.role === 'assistant' && !msg.content
            const isThinking = isGenerating && isLastMessage && isEmptyAIMessage

            items.push({
                key: msg.id,
                role: msg.role === 'user' ? 'user' : 'ai',
                content: msg.content,
                loading: false,
                extraInfo: {
                    isStreaming: msg.isStreaming,
                    isThinking,
                    duration: msg.duration,
                    sources: msg.sources
                },
                variant: 'borderless' as const
            })
        })

        return items
    }, [messages, isGenerating])

    const roles = {
        label: {
            placement: 'start' as const,
            variant: 'borderless' as const,
            avatar: null,
            styles: {
                root: {
                    paddingInlineStart: 0,
                    marginInline: 0,
                    width: '100%',
                    maxWidth: 'none'
                },
                content: {
                    backgroundColor: 'transparent',
                    padding: 0,
                    margin: 0,
                    boxShadow: 'none',
                    width: '100%',
                    maxWidth: 'none',
                    display: 'flex',
                    justifyContent: 'center'
                }
            }
        },
        user: {
            placement: 'end' as const,
            variant: 'borderless' as const,
            styles: {
                content: {
                    backgroundColor: 'transparent',
                    padding: 0
                }
            },
            avatar: (
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-200 text-slate-600">
                    <User className="h-4 w-4" />
                </div>
            ),
            contentRender: (content: string) => (
                <div className="group flex items-center gap-2">
                    {/* 左侧独立的按钮区域 - 悬浮显示 */}
                    <div className="flex items-center space-x-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <CopyButton
                            content={content}
                            className="text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-md transition-all"
                        />
                        <button
                            type="button"
                            onClick={() => setInputValue(content)}
                            className="p-1.5 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all"
                            title="编辑此消息"
                        >
                            <Pencil className="h-3.5 w-3.5" />
                        </button>
                    </div>
                    {/* 浅灰色气泡 */}
                    <div className="px-3 py-2 bg-slate-100/80 dark:bg-slate-800/80 rounded-xl rounded-tr-none text-slate-800 dark:text-slate-200">
                        <div className="whitespace-pre-wrap leading-relaxed text-[12px]">{content}</div>
                    </div>
                </div>
            )
        },
        ai: {
            placement: 'start' as const,
            variant: 'borderless' as const,
            avatar: (
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
                    <Bot className="h-4 w-4" />
                </div>
            ),
            contentRender: (content: string, info: { extraInfo?: { isStreaming?: boolean; isThinking?: boolean; duration?: number } }) => {
                // AI 正在思考中的加载状态
                if (info.extraInfo?.isThinking && !content) {
                    return (
                        <div className="flex items-center gap-3 py-2">
                            <div className="flex items-center gap-1.5">
                                <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: '0ms' }} />
                                <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: '150ms' }} />
                                <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: '300ms' }} />
                            </div>
                            <span className="text-[12px] text-muted-foreground animate-pulse">AI 正在思考...</span>
                        </div>
                    )
                }

                return (
                    <div className="relative">
                        <MessageContent
                            content={content}
                            isStreaming={info.extraInfo?.isStreaming}
                            sources={(info.extraInfo as any)?.sources}
                        />
                        {!info.extraInfo?.isStreaming && content && (
                            <div className="flex items-center justify-start gap-3 mt-2 border-t border-border/10 pt-1.5">
                                <CopyButton content={content} className="opacity-60 hover:opacity-100 transition-opacity" />
                                <TTSButton content={content} className="opacity-60 hover:opacity-100 transition-opacity text-muted-foreground" />
                                {info.extraInfo?.duration && (
                                    <span className="text-[10px] text-muted-foreground/40 font-mono">
                                        耗时 {info.extraInfo.duration.toFixed(1)} 秒
                                    </span>
                                )}
                            </div>
                        )}
                    </div>
                )
            }
        }
    }

    // 渲染服务状态 (使用 shadcn Badge)
    const renderStatus = () => {
        if (serviceLoading) {
            return (
                <Badge variant="secondary" className="gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    加载中
                </Badge>
            )
        }
        if (!isConnected) {
            return (
                <Badge variant="destructive" className="gap-1">
                    未连接
                </Badge>
            )
        }
        if (!isOllamaAvailable) {
            return (
                <Badge variant="secondary" className="gap-1 bg-yellow-500/20 text-yellow-600">
                    Ollama 离线
                </Badge>
            )
        }
        return (
            <Badge variant="secondary" className="gap-1 bg-green-500/10 text-green-600 border-none text-[11px] h-5 px-1.5">
                已连接
            </Badge>
        )
    }

    return (
        <TooltipProvider delayDuration={300}>
            <div className="flex h-full flex-col">
                {!isConnected && !serviceLoading && (
                    <div className="mb-4">
                        <Alert
                            message="已断开与 AI Engine 的连接"
                            description={
                                <div className="flex items-center gap-2">
                                    <span>请在 「AI 引擎」 页面启动服务以使用 MyGPT 功能。</span>
                                    <Button size="sm" variant="outline" onClick={() => startService()} className="h-7 px-2 text-[12px]">
                                        尝试启动
                                    </Button>
                                    <Button size="sm" variant="link" onClick={() => window.location.hash = '#/ai-engine'} className="h-7 px-2 text-[12px]">
                                        前往管理
                                    </Button>
                                </div>
                            }
                            type="warning"
                            showIcon
                            closable={false}
                        />
                    </div>
                )}
                {/* 顶部工具栏 - 使用 shadcn/ui */}
                <div className="flex shrink-0 items-center justify-between gap-4 pb-4">
                    <div className="flex items-center gap-2">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
                            <Bot className="h-4 w-4 text-primary" />
                        </div>
                        <div>
                            <h2 className="text-[13px] font-semibold leading-none">Chat</h2>
                            <p className="text-[12px] text-muted-foreground mt-0.5">本地 AI 对话助手</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        {renderStatus()}

                        {/* 模型选择 — 使用通用 ModelSelector */}
                        <ModelSelector
                            value={selectedModel}
                            onValueChange={handleModelChange}
                            ollamaModels={models}
                        />

                        {/* 知识库选择器 - 优化为下拉菜单 */}
                        {indexedKnowledgeBases.length > 0 && (
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-8 gap-1 px-2 border-dashed hover:border-primary transition-all text-[12px]"
                                    >
                                        <div className="flex items-center gap-2">
                                            <BookOpen className="h-4 w-4 text-muted-foreground" />
                                            <span className="max-w-[120px] truncate">
                                                {selectedKBIds.length === 0
                                                    ? '选择知识库'
                                                    : selectedKBIds.length === 1
                                                        ? indexedKnowledgeBases.find(k => k.id === selectedKBIds[0])?.name
                                                        : `已选 ${selectedKBIds.length} 个知识库`}
                                            </span>
                                            {selectedKBIds.length > 0 && (
                                                <Badge
                                                    variant="secondary"
                                                    className="h-5 px-1 min-w-[1.25rem] flex items-center justify-center rounded-full text-[10px] bg-primary/10 text-primary border-none"
                                                >
                                                    {selectedKBIds.length}
                                                </Badge>
                                            )}
                                        </div>
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-64 p-2">
                                    <DropdownMenuLabel className="flex items-center justify-between py-1.5">
                                        <span>可用知识库</span>
                                        {selectedKBIds.length > 0 && (
                                            <Button
                                                variant="ghost"
                                                className="h-auto p-0 text-[10px] text-muted-foreground hover:text-primary"
                                                onClick={(e) => {
                                                    e.preventDefault();
                                                    setSelectedKBIds([]);
                                                }}
                                            >
                                                清除全部
                                            </Button>
                                        )}
                                    </DropdownMenuLabel>
                                    <DropdownMenuSeparator className="my-1" />
                                    <ScrollArea className="h-auto max-h-64 pr-2">
                                        <div className="space-y-1">
                                            {indexedKnowledgeBases.map((kb) => (
                                                <DropdownMenuCheckboxItem
                                                    key={kb.id}
                                                    checked={selectedKBIds.includes(kb.id)}
                                                    onCheckedChange={(checked) => {
                                                        if (checked) {
                                                            setSelectedKBIds([...selectedKBIds, kb.id])
                                                        } else {
                                                            setSelectedKBIds(selectedKBIds.filter(id => id !== kb.id))
                                                        }
                                                    }}
                                                    className="flex items-center gap-2 py-2 cursor-pointer"
                                                    onSelect={(e) => e.preventDefault()} // 防止由于选择导致菜单关闭
                                                >
                                                    <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                                                        <div className="flex items-center gap-1.5">
                                                            <span className="text-[11px] shrink-0">
                                                                {kb.type === 'obsidian' ? '📝' : kb.type === 'pdf' ? '📄' : '💻'}
                                                            </span>
                                                            <span className="text-[11px] font-medium truncate">{kb.name}</span>
                                                        </div>
                                                        <span className="text-[10px] text-muted-foreground truncate opacity-70">
                                                            {kb.docCount} 篇文档
                                                        </span>
                                                    </div>
                                                </DropdownMenuCheckboxItem>
                                            ))}
                                        </div>
                                    </ScrollArea>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        )}

                        {/* RAG 开关 */}
                        {indexedKnowledgeBases.length > 0 && (
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <div className="flex items-center gap-2">
                                        <Switch
                                            checked={isRAGEnabled}
                                            onChange={setIsRAGEnabled}
                                            id="rag-mode"
                                            size="small"
                                        />
                                        <Label htmlFor="rag-mode" className="text-[11px] font-medium cursor-pointer">
                                            {isRAGEnabled ? '联网/知识库' : '纯对话'}
                                        </Label>
                                    </div>
                                </TooltipTrigger>
                                <TooltipContent>
                                    {isRAGEnabled
                                        ? "已启用知识库上下文，将尝试检索相关信息回答"
                                        : "仅使用大模型原生能力，不使用知识库"}
                                </TooltipContent>
                            </Tooltip>
                        )}

                        {/* 刷新模型 */}
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => fetchModels()}
                                    disabled={!isConnected}
                                >
                                    <RefreshCw className="h-4 w-4" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>刷新模型列表</TooltipContent>
                        </Tooltip>

                        {/* 新建会话 */}
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" onClick={handleNewSession}>
                                    <Plus className="h-4 w-4" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>新建会话</TooltipContent>
                        </Tooltip>

                        {/* 历史会话 */}
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => setHistorySheetOpen(true)}
                                >
                                    <HistoryIcon className="h-4 w-4" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>历史会话</TooltipContent>
                        </Tooltip>
                        <Sheet open={historySheetOpen} onOpenChange={setHistorySheetOpen}>
                            <SheetContent side="right" className="w-80">
                                <SheetHeader>
                                    <SheetTitle>历史会话</SheetTitle>
                                </SheetHeader>
                                <ScrollArea className="h-[calc(100vh-100px)] mt-4">
                                    <div className="space-y-2 pr-4">
                                        {sessions.map((session) => (
                                            <div
                                                key={session.id}
                                                className={`group relative p-3 rounded-lg cursor-pointer transition-colors ${session.id === currentSession?.id
                                                    ? 'bg-primary/10 border border-primary/20'
                                                    : 'hover:bg-muted'
                                                    }`}
                                                onClick={() => {
                                                    switchSession(session.id)
                                                    setHistorySheetOpen(false)
                                                }}
                                            >
                                                <div className="flex items-start gap-2">
                                                    <MessageSquare className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-1.5">
                                                            <p className="text-[11px] font-medium truncate flex-1">
                                                                {session.title}
                                                            </p>
                                                            {session.channel === 'feishu' && (
                                                                <span className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                                                                    飞书
                                                                </span>
                                                            )}
                                                        </div>
                                                        <p className="text-[10px] text-muted-foreground">
                                                            {new Date(
                                                                session.updatedAt
                                                            ).toLocaleString()}
                                                        </p>
                                                        <p className="text-[10px] text-muted-foreground">
                                                            {session.messages.length} 条消息
                                                        </p>
                                                    </div>
                                                </div>
                                                {/* 删除按钮 */}
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="absolute right-1 top-1 h-6 w-6 opacity-0 group-hover:opacity-100"
                                                    onClick={(e) => {
                                                        e.stopPropagation()
                                                        removeSession(session.id)
                                                    }}
                                                >
                                                    <Trash2 className="h-3 w-3 text-muted-foreground" />
                                                </Button>
                                            </div>
                                        ))}
                                        {sessions.length === 0 && (
                                            <div className="text-center text-muted-foreground py-8">
                                                <MessageSquare className="h-12 w-12 mx-auto mb-2 opacity-20" />
                                                <p className="text-[11px]">暂无历史会话</p>
                                            </div>
                                        )}
                                    </div>
                                </ScrollArea>
                            </SheetContent>
                        </Sheet>

                        {/* 配置 */}
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => {
                                        setConfigDialogOpen(true)
                                    }}
                                >
                                    <Settings className="h-4 w-4" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>模型配置</TooltipContent>
                        </Tooltip>
                    </div>
                </div>

                {/* 消息区域 - 使用 Ant Design X */}
                <ConfigProvider theme={antdTheme}>
                    <XProvider>
                        <div
                            className="antd-scope flex-1 overflow-hidden rounded-lg border bg-card"
                            style={{ minHeight: 0 }}
                        >
                            {messages.length === 0 ? (
                                <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
                                    <Bot className="mb-3 h-12 w-12 opacity-15" />
                                    <p className="text-[11px] font-medium">开始一段新对话</p>
                                    <p className="mt-1 text-[11px]">
                                        {isConnected ? '输入消息开始与 AI 对话' : '请先启动 AI Engine'}
                                    </p>
                                    {serviceError && (
                                        <p className="mt-2 text-[11px] text-destructive">{serviceError}</p>
                                    )}
                                </div>
                            ) : (
                                <div ref={scrollAreaRef} className="h-full overflow-auto px-4 py-2">
                                    <Bubble.List items={bubbleItems} role={roles} autoScroll />
                                </div>
                            )}
                        </div>

                        {/* 输入区域 */}
                        <div className="antd-scope shrink-0 pt-4">
                            <Sender
                                value={inputValue}
                                onChange={setInputValue}
                                placeholder={
                                    isConnected ? '输入消息，按 Enter 发送...' : '请先启动 AI Engine...'
                                }
                                disabled={!isConnected}
                                loading={isGenerating}
                                onSubmit={handleSend}
                                onCancel={handleCancel}
                                style={{ borderRadius: 8, fontSize: '12px' }}
                            />
                            <p className="mt-1.5 text-[11px] text-muted-foreground/60">
                                模型: {selectedModel} · 支持思维链展示 · 按 Shift+Enter 换行
                            </p>
                        </div>
                    </XProvider>
                </ConfigProvider>

                {/* 配置弹窗 */}
                <Dialog open={configDialogOpen} onOpenChange={setConfigDialogOpen}>
                    <DialogContent className="max-w-2xl">
                        <DialogHeader>
                            <DialogTitle>设置</DialogTitle>
                            <DialogDescription>
                                管理本地知识库
                            </DialogDescription>
                        </DialogHeader>

                        <KnowledgeBaseSettings
                            knowledgeBases={knowledgeBases}
                            onAddKB={handleAddKB}
                            onDeleteKB={handleDeleteKB}
                            onBuildIndex={handleBuildIndex}
                        />
                    </DialogContent>
                </Dialog>
            </div >
        </TooltipProvider >
    )
}
