import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { invoke, convertFileSrc } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import {
    ClipboardList,
    Search,
    Check,
    Code,
    FileText,
    Image,
    Globe,
    Terminal,
    Clock,
    Shield,
    Camera,
    Settings,
    X,
    CornerDownLeft,
    Monitor,
    Radio,
    Calculator,
    Wrench,
    LayoutDashboard,
    Compass,
    Server,
    Clipboard,
    Timer,
    MonitorPlay,
    Lock,
    Skull,
    AlertTriangle
} from 'lucide-react'
import { tools as toolboxTools } from '@/pages/ToolboxPage'

type HubMode = 'clipboard' | 'command'
type ClipboardItemType = 'text' | 'image' | 'html' | 'color' | 'code'

interface ListeningPort {
    protocol: 'tcp' | 'udp'
    localAddress: string
    port: number
    pid: number
    processName: string
    command?: string
}

interface ClipboardItem {
    id: string
    type: ClipboardItemType
    content: string
    preview: string
    sourceApp: string
    timestamp: number
    imagePath?: string
    thumbPath?: string
    language?: string
    colorValue?: string
}

interface CommandItem {
    id: string
    title: string
    subtitle: string
    icon: React.ReactNode
    category: string
    action: () => void | Promise<void>
    secondaryAction?: () => void | Promise<void>
    secondaryLabel?: string
    isConflict?: boolean
}


function formatRelativeTime(timestamp: number): string {
    const diff = Math.floor((Date.now() - timestamp) / 1000)
    if (diff < 30) return '刚刚'
    if (diff < 60) return `${diff}秒前`
    if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`
    const hours = Math.floor(diff / 3600)
    return `${hours}小时前`
}

function HubImageThumbnail({ imagePath, thumbPath }: { imagePath: string; thumbPath?: string }) {
    const [src, setSrc] = useState(() => convertFileSrc(thumbPath || imagePath))
    const [failedAsset, setFailedAsset] = useState(false)

    useEffect(() => {
        setSrc(convertFileSrc(thumbPath || imagePath))
        setFailedAsset(false)
    }, [imagePath, thumbPath])

    useEffect(() => {
        if (!failedAsset) return
        let cancelled = false
        invoke<string>('clipboard_get_image_data', { imagePath })
            .then((res) => {
                if (!cancelled && res) setSrc(res)
            })
            .catch(() => {})
        return () => {
            cancelled = true
        }
    }, [failedAsset, imagePath])

    if (!src) {
        return (
            <div className="w-9 h-9 rounded-md bg-zinc-800 flex items-center justify-center shrink-0 border border-zinc-700/60">
                <Image className="h-4 w-4 text-zinc-500 animate-pulse" />
            </div>
        )
    }

    return (
        <div className="w-9 h-9 rounded-md overflow-hidden shrink-0 border border-zinc-700/80 bg-zinc-950 shadow-xs">
            <img
                src={src}
                alt="预览"
                className="w-full h-full object-cover"
                onError={() => {
                    if (!failedAsset) setFailedAsset(true)
                }}
            />
        </div>
    )
}

export function QuickHubView(): React.ReactElement {
    const [mode, setMode] = useState<HubMode>('clipboard')
    const [query, setQuery] = useState('')
    const [selectedIndex, setSelectedIndex] = useState(0)

    // 剪贴板状态
    const [clips, setClips] = useState<ClipboardItem[]>([])
    const [, setLoadingClips] = useState(false)
    const [copiedId, setCopiedId] = useState<string | null>(null)

    const inputRef = useRef<HTMLInputElement>(null)
    const listRef = useRef<HTMLDivElement>(null)

    // 关闭 HUB 悬浮窗
    const handleClose = useCallback(async () => {
        try {
            await invoke('hub_hide')
        } catch {
            await getCurrentWindow().hide().catch(() => {})
        }
    }, [])

    // 唤起主窗口并导航到某页面
    const navigateMainTo = useCallback(async (page: string, toolId?: string) => {
        await invoke('open_main_window')
        if (toolId) {
            window.dispatchEvent(new CustomEvent('open-tool', { detail: { toolId } }))
        } else {
            window.dispatchEvent(new CustomEvent('navigate-to-page', { detail: { page } }))
        }
    }, [])

    // 加载最近剪贴板
    const fetchClips = useCallback(async () => {
        setLoadingClips(true)
        try {
            const list = await invoke<ClipboardItem[]>('clipboard_get_items', { limit: 25, offset: 0 })
            setClips(list || [])
        } catch (e) {
            console.error('Failed to fetch clipboard items for HUB:', e)
        } finally {
            setLoadingClips(false)
        }
    }, [])

    // 监听后端模式派发 (Option+V -> clipboard, Option+K -> command)
    useEffect(() => {
        const unlistenPromise = listen<string>('eva://hub-mode', (event) => {
            const targetMode = event.payload === 'command' ? 'command' : 'clipboard'
            setMode(targetMode)
            setQuery('')
            setSelectedIndex(0)
            if (targetMode === 'clipboard') {
                fetchClips()
            }
            setTimeout(() => {
                inputRef.current?.focus()
                inputRef.current?.select()
            }, 50)
        })

        // 默认初始化拉一次剪贴板
        fetchClips()

        return () => {
            unlistenPromise.then(unlisten => unlisten())
        }
    }, [fetchClips])

    // 当窗口获得焦点时自动重置并拉取
    useEffect(() => {
        const handleFocus = () => {
            inputRef.current?.focus()
            if (mode === 'clipboard') {
                fetchClips()
            }
        }
        window.addEventListener('focus', handleFocus)
        return () => window.removeEventListener('focus', handleFocus)
    }, [mode, fetchClips])

    // 确保 Hub 浮窗始终拥有沉浸式暗色半透明主题，防止 body 浅色背景干扰
    useEffect(() => {
        const root = document.documentElement
        const body = document.body
        root.classList.add('dark')
        root.classList.remove('light')
        const prevBg = body.style.backgroundColor
        body.style.backgroundColor = 'transparent'
        return () => {
            body.style.backgroundColor = prevBg
        }
    }, [])

    // 端口列表与冲突检测状态（需在 handleCopyItem 之前声明，供失败提示使用）
    const [ports, setPorts] = useState<ListeningPort[]>([])
    const [statusMessage, setStatusMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

    // 复制剪贴板条目 (通过后端真实写回系统剪贴板，支持图片二进制解码与富文本)
    // 失败时只提示，不用列表里已截断的 content 兜底写回
    const handleCopyItem = useCallback(async (item: ClipboardItem) => {
        try {
            setCopiedId(item.id)
            const ok = window.api?.clipboard?.writeToClipboard
                ? await window.api.clipboard.writeToClipboard(item.id)
                : await invoke<boolean>('clipboard_write_to_clipboard', { id: item.id })
            if (!ok) {
                throw new Error('clipboard write returned false')
            }
            // 短暂保留打勾反馈，160ms 后优雅隐去窗口
            setTimeout(() => {
                handleClose()
                setCopiedId(null)
            }, 160)
        } catch (e) {
            console.error('Failed to copy item via backend:', e)
            setCopiedId(null)
            setStatusMessage({ text: '写回剪贴板失败', type: 'error' })
            setTimeout(() => setStatusMessage(null), 2400)
        }
    }, [handleClose])

    const fetchPorts = useCallback(async () => {
        try {
            if (window.api?.getListeningPorts) {
                const res = await window.api.getListeningPorts()
                setPorts(res || [])
            }
        } catch (e) {
            console.warn('Failed to fetch ports in HUB:', e)
        }
    }, [])

    // 杀死占用端口的进程
    const handleKillPort = useCallback(async (pid: number, port: number) => {
        try {
            if (window.api?.killProcess) {
                const res = await window.api.killProcess(pid)
                if (res.success) {
                    setStatusMessage({ text: `✓ 已终止 PID ${pid}，端口 ${port} 已释放`, type: 'success' })
                    await fetchPorts()
                } else {
                    setStatusMessage({ text: `✕ 终止失败: ${res.message || '权限不足'}`, type: 'error' })
                }
            }
        } catch (e) {
            setStatusMessage({ text: `✕ 终止出错: ${String(e)}`, type: 'error' })
        } finally {
            setTimeout(() => setStatusMessage(null), 2400)
        }
    }, [fetchPorts])

    // 打开或切换到 command 模式时拉取端口
    useEffect(() => {
        if (mode === 'command') {
            fetchPorts()
        }
    }, [mode, fetchPorts])

    // 统计各端口出现频次以检测多进程竞争与冲突
    const portOccurrences = useMemo(() => {
        const counts = new Map<number, number>()
        ports.forEach(p => {
            counts.set(p.port, (counts.get(p.port) || 0) + 1)
        })
        return counts
    }, [ports])

    // 综合计算全部候选命令、端口探测与工具直达
    const filteredCommands = useMemo<CommandItem[]>(() => {
        const list: CommandItem[] = []
        const trimmed = query.trim().toLowerCase()

        // 1. 即时数学计算器 (输入算式直接出答案)
        if (/^[\d\s+\-*/%().^]+$/.test(trimmed) && trimmed.length >= 2) {
            try {
                // eslint-disable-next-line no-eval
                const result = Function(`'use strict'; return (${trimmed})`)()
                if (typeof result === 'number' && !isNaN(result)) {
                    list.push({
                        id: `calc-${result}`,
                        category: '速算结果',
                        title: `${result}`,
                        subtitle: `表达式: ${query.trim()} · 按回车写回剪贴板`,
                        icon: <Calculator className="h-4 w-4 text-amber-400" />,
                        action: async () => {
                            await navigator.clipboard.writeText(String(result))
                            handleClose()
                        }
                    })
                }
            } catch {}
        }

        // 2. 本地端口探测与直达 (输入数字如 5173、3000，或输入 port / 端口 / kill / 杀 / 冲突 / conflict)
        const isPortQuery = /^\d+$/.test(trimmed) || 
            trimmed.includes('port') || 
            trimmed.includes('端口') || 
            trimmed.includes('kill') || 
            trimmed.includes('杀') || 
            trimmed.includes('冲突') || 
            trimmed.includes('conflict')
        const targetNum = trimmed.replace(/\D/g, '')

        ports.forEach(p => {
            const portStr = String(p.port)
            const matchesNumber = targetNum ? portStr.includes(targetNum) : false
            const matchesText = trimmed ? p.processName.toLowerCase().includes(trimmed) : false
            const hasConflict = (portOccurrences.get(p.port) || 0) > 1
            const matchesConflict = (trimmed.includes('冲突') || trimmed.includes('conflict')) && hasConflict
            const matchesKill = (trimmed.includes('kill') || trimmed.includes('杀'))

            if ((isPortQuery && (!targetNum || matchesNumber)) || matchesText || matchesConflict || matchesKill || (trimmed === 'port') || (trimmed === '端口')) {
                list.push({
                    id: `port-${p.port}-${p.pid}`,
                    category: hasConflict ? '端口冲突' : '本地端口',
                    isConflict: hasConflict,
                    title: `端口 ${p.port} (${p.processName})`,
                    subtitle: `PID: ${p.pid} · 绑定: ${p.localAddress}${hasConflict ? ' · ⚠️ 检测到同端口多重占用冲突' : ''}`,
                    icon: hasConflict ? (
                        <AlertTriangle className="h-4 w-4 text-rose-400 animate-bounce" />
                    ) : (
                        <Radio className="h-4 w-4 text-emerald-400 animate-pulse" />
                    ),
                    action: async () => {
                        handleClose()
                        if (window.api?.openInBrowser) {
                            await window.api.openInBrowser(`http://localhost:${p.port}`)
                        } else {
                            window.open(`http://localhost:${p.port}`, '_blank')
                        }
                    },
                    secondaryLabel: 'Kill 释放',
                    secondaryAction: () => handleKillPort(p.pid, p.port)
                })
            }
        })


        // 3. 常用工具箱直达 (JSON、时间戳、正则、Base64等)
        toolboxTools.forEach(tool => {
            const matchTitle = tool.title.toLowerCase().includes(trimmed)
            const matchDesc = tool.description.toLowerCase().includes(trimmed)
            const matchId = tool.id.toLowerCase().includes(trimmed)

            if (!trimmed || matchTitle || matchDesc || matchId) {
                list.push({
                    id: `tool-${tool.id}`,
                    category: '实用工具',
                    title: tool.title,
                    subtitle: tool.description,
                    icon: <Wrench className="h-4 w-4 text-violet-400" />,
                    action: () => navigateMainTo('toolbox', tool.id)
                })
            }
        })

        // 4. 核心页面导航
        const navList = [
            { id: 'dashboard', title: '仪表盘', subtitle: '概览、时间活跃与 EVA 智能副驾', icon: <LayoutDashboard className="h-4 w-4 text-blue-400" /> },
            { id: 'navigation', title: '网站导航', subtitle: '分类书签与常用工具链站点', icon: <Compass className="h-4 w-4 text-indigo-400" /> },
            { id: 'services', title: '本地服务', subtitle: '本地微服务管理与启停控制', icon: <Server className="h-4 w-4 text-emerald-400" /> },
            { id: 'toolbox', title: '全部工具箱', subtitle: '端口、环境、密码与各类开发者瑞士军刀', icon: <Wrench className="h-4 w-4 text-violet-400" /> },
            { id: 'clipboard', title: '剪贴板历史', subtitle: '富媒体剪贴记录与模糊全文搜索', icon: <Clipboard className="h-4 w-4 text-amber-400" /> },
            { id: 'timeauditor', title: '时间审计看板', subtitle: '全天工作时长、工程投入占比与热力流', icon: <Timer className="h-4 w-4 text-pink-400" /> },
            { id: 'visualrecall', title: '视觉回溯', subtitle: '工作记忆快照与时间旅行回放', icon: <MonitorPlay className="h-4 w-4 text-cyan-400" /> },
            { id: 'vault', title: '加密保险箱', subtitle: 'Touch ID 与敏感凭据保险库', icon: <Lock className="h-4 w-4 text-rose-400" /> },
            { id: 'settings', title: '系统设置', subtitle: '全局快捷键、模型 API 与个性化外观', icon: <Settings className="h-4 w-4 text-zinc-400" /> },
        ]

        navList.forEach(n => {
            if (!trimmed || n.title.toLowerCase().includes(trimmed) || n.subtitle.toLowerCase().includes(trimmed) || n.id.includes(trimmed)) {
                list.push({
                    id: `nav-${n.id}`,
                    category: '页面跳转',
                    title: n.title,
                    subtitle: n.subtitle,
                    icon: n.icon,
                    action: () => navigateMainTo(n.id)
                })
            }
        })

        return list
    }, [query, ports, handleClose, navigateMainTo])

    // 过滤后的剪贴板条目
    const filteredClips = useMemo(() => {
        if (!query.trim()) return clips
        const q = query.toLowerCase()
        return clips.filter(c =>
            c.content.toLowerCase().includes(q) ||
            c.sourceApp.toLowerCase().includes(q)
        )
    }, [clips, query])

    const currentTotalItems = mode === 'clipboard' ? filteredClips.length : filteredCommands.length

    // 键盘导航 (上下选择、回车确认、数字键直达、Esc 关闭)
    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Escape') {
            e.preventDefault()
            handleClose()
            return
        }

        if (e.key === 'Tab') {
            e.preventDefault()
            setMode(prev => prev === 'clipboard' ? 'command' : 'clipboard')
            setSelectedIndex(0)
            setQuery('')
            return
        }

        if (e.key === 'ArrowDown') {
            e.preventDefault()
            if (currentTotalItems > 0) {
                setSelectedIndex(prev => (prev + 1) % currentTotalItems)
            }
            return
        }

        if (e.key === 'ArrowUp') {
            e.preventDefault()
            if (currentTotalItems > 0) {
                setSelectedIndex(prev => (prev - 1 + currentTotalItems) % currentTotalItems)
            }
            return
        }

        if (e.key === 'Enter') {
            e.preventDefault()
            if (mode === 'clipboard') {
                const target = filteredClips[selectedIndex]
                if (target) {
                    handleCopyItem(target)
                }
            } else {
                const target = filteredCommands[selectedIndex]
                if (target) {
                    target.action()
                }
            }
            return
        }

        // 命令模式下如果当前条目有 secondaryAction (例如 Kill 端口进程)，支持按 Cmd+Backspace / Option+Backspace / Cmd+D 快速终止
        if (mode === 'command' && (
            (e.key === 'Backspace' && (e.metaKey || e.altKey)) ||
            (e.key === 'd' && (e.metaKey || e.ctrlKey))
        )) {
            const target = filteredCommands[selectedIndex]
            if (target?.secondaryAction) {
                e.preventDefault()
                target.secondaryAction()
                return
            }
        }

        // 剪贴板模式下支持按 1~9 快捷选用
        if (mode === 'clipboard' && !query && /^[1-9]$/.test(e.key)) {
            const idx = parseInt(e.key, 10) - 1
            if (idx < filteredClips.length) {
                e.preventDefault()
                handleCopyItem(filteredClips[idx])
            }
        }
    }

    // 自动滚动保持当前选中条目可见
    useEffect(() => {
        if (listRef.current) {
            const activeElem = listRef.current.querySelector(`[data-index="${selectedIndex}"]`)
            if (activeElem) {
                activeElem.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
            }
        }
    }, [selectedIndex])

    return (
        <div 
            className="w-full h-full flex flex-col select-none overflow-hidden rounded-2xl border border-white/10 bg-[#16161a] text-zinc-100 shadow-2xl backdrop-blur-2xl"
            onKeyDown={handleKeyDown}
        >
            {/* 顶部搜索与模式胶囊栏 */}
            <div className="p-3.5 border-b border-white/10 flex items-center gap-2.5 bg-zinc-900/90 shrink-0">
                <div className="flex items-center gap-2 text-zinc-400 pl-1">
                    {mode === 'clipboard' ? (
                        <ClipboardList className="h-5 w-5 text-indigo-400 animate-in zoom-in-75 duration-150" />
                    ) : (
                        <Search className="h-5 w-5 text-violet-400 animate-in zoom-in-75 duration-150" />
                    )}
                </div>

                <input
                    ref={inputRef}
                    autoFocus
                    value={query}
                    onChange={(e) => {
                        setQuery(e.target.value)
                        setSelectedIndex(0)
                    }}
                    placeholder={
                        mode === 'clipboard'
                            ? '过滤剪贴板记录... (按 1-9 快捷选用)'
                            : '输入端口号(如 5173、3000)、进程名、kill 或指令...'
                    }
                    className="flex-1 !bg-transparent text-sm text-zinc-100 placeholder-zinc-500 !border-none !shadow-none !ring-0 !outline-none focus:!ring-0 focus:!ring-offset-0 !px-0 !py-0 tracking-wide"
                />

                {/* 模式切换胶囊 */}
                <div className="flex items-center p-0.5 rounded-lg bg-zinc-800/80 border border-zinc-700/60 text-[11px] font-medium">
                    <button
                        onClick={() => {
                            setMode('clipboard')
                            setSelectedIndex(0)
                            fetchClips()
                            inputRef.current?.focus()
                        }}
                        className={`px-2.5 py-1 rounded-md transition-all flex items-center gap-1 cursor-pointer ${
                            mode === 'clipboard'
                                ? 'bg-indigo-600 text-white shadow-xs font-semibold'
                                : 'text-zinc-400 hover:text-zinc-200'
                        }`}
                    >
                        <ClipboardList className="h-3 w-3" />
                        剪贴板 <span className="opacity-60 text-[9px]">⌥V</span>
                    </button>
                    <button
                        onClick={() => {
                            setMode('command')
                            setSelectedIndex(0)
                            inputRef.current?.focus()
                        }}
                        className={`px-2.5 py-1 rounded-md transition-all flex items-center gap-1 cursor-pointer ${
                            mode === 'command'
                                ? 'bg-violet-600 text-white shadow-xs font-semibold'
                                : 'text-zinc-400 hover:text-zinc-200'
                        }`}
                    >
                        <Terminal className="h-3 w-3" />
                        命令搜索 <span className="opacity-60 text-[9px]">⌥K</span>
                    </button>
                </div>

                <button
                    onClick={handleClose}
                    className="text-zinc-400 hover:text-zinc-200 p-1 rounded-md hover:bg-zinc-800 transition-colors cursor-pointer"
                >
                    <X className="h-4 w-4" />
                </button>
            </div>

            {/* 状态操作通知浮条 (如终止进程释放端口反馈) */}
            {statusMessage && (
                <div className={`px-3.5 py-1.5 text-xs font-mono flex items-center justify-between border-b animate-in fade-in slide-in-from-top-1 duration-150 shrink-0 ${
                    statusMessage.type === 'success' 
                        ? 'bg-emerald-950/90 text-emerald-300 border-emerald-800/60' 
                        : 'bg-rose-950/90 text-rose-300 border-rose-800/60'
                }`}>
                    <span>{statusMessage.text}</span>
                    <button onClick={() => setStatusMessage(null)} className="text-zinc-400 hover:text-zinc-200">
                        <X className="h-3 w-3" />
                    </button>
                </div>
            )}

            {/* 内容列表区 */}
            <div ref={listRef} className="flex-1 overflow-y-auto p-2 space-y-1.5 scrollbar-thin bg-[#121215]">
                {mode === 'clipboard' ? (
                    filteredClips.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-48 text-zinc-500 text-xs">
                            <ClipboardList className="h-8 w-8 mb-2 opacity-30" />
                            {query ? '未搜索到匹配的剪贴板记录' : '暂无剪贴板历史'}
                        </div>
                    ) : (
                        filteredClips.map((item, index) => {
                            const isSelected = selectedIndex === index
                            const isCopied = copiedId === item.id

                            return (
                                <div
                                    key={item.id}
                                    data-index={index}
                                    onClick={() => handleCopyItem(item)}
                                    onMouseEnter={() => setSelectedIndex(index)}
                                    className={`px-3 py-2.5 rounded-xl flex items-center justify-between gap-3 cursor-pointer transition-all duration-100 ${
                                        isSelected
                                            ? 'bg-indigo-600/30 border border-indigo-500/50 shadow-inner text-white'
                                            : 'hover:bg-zinc-800/60 border border-transparent text-zinc-300'
                                    }`}
                                >
                                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                        {/* 1~9 快捷角标 */}
                                        {index < 9 && !query ? (
                                            <span className={`w-4 h-4 rounded text-[10px] font-mono flex items-center justify-center shrink-0 border ${
                                                isSelected
                                                    ? 'bg-indigo-600 text-white border-indigo-400 font-semibold'
                                                    : 'bg-zinc-800 text-zinc-300 border-zinc-700/60 font-medium'
                                            }`}>
                                                {index + 1}
                                            </span>
                                        ) : (
                                            <span className="w-1.5 h-1.5 rounded-full bg-zinc-600 shrink-0 ml-1.5" />
                                        )}

                                        {/* 类型图标/图片缩略图 */}
                                        {item.type === 'image' && item.imagePath ? (
                                            <HubImageThumbnail imagePath={item.imagePath} thumbPath={item.thumbPath} />
                                        ) : item.type === 'code' ? (
                                            <div className="w-8 h-8 rounded-lg bg-zinc-800/90 border border-zinc-700/60 flex items-center justify-center shrink-0 text-cyan-400">
                                                <Code className="h-4 w-4" />
                                            </div>
                                        ) : item.content.startsWith('http') ? (
                                            <div className="w-8 h-8 rounded-lg bg-zinc-800/90 border border-zinc-700/60 flex items-center justify-center shrink-0 text-blue-400">
                                                <Globe className="h-4 w-4" />
                                            </div>
                                        ) : (
                                            <div className="w-8 h-8 rounded-lg bg-zinc-800/90 border border-zinc-700/60 flex items-center justify-center shrink-0 text-zinc-300">
                                                <FileText className="h-4 w-4" />
                                            </div>
                                        )}

                                        {/* 文字预览与信息 */}
                                        <div className="min-w-0 flex-1">
                                            <p className={`text-xs font-mono line-clamp-1 break-all ${
                                                isSelected ? 'text-white font-medium' : 'text-zinc-100 font-normal'
                                            }`}>
                                                {item.type === 'image' ? '[剪贴板图片]' : item.content.trim()}
                                            </p>
                                            <div className="flex items-center gap-2 mt-0.5 text-[10px] text-zinc-400">
                                                {item.sourceApp && item.sourceApp !== 'Unknown' && (
                                                    <span className="truncate max-w-[120px] px-1 py-0.2 rounded bg-zinc-800/80 text-zinc-300 border border-zinc-700/40">
                                                        {item.sourceApp}
                                                    </span>
                                                )}
                                                <span>{formatRelativeTime(item.timestamp)}</span>
                                                <span>{item.content.length} 字符</span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* 右侧动作标识 */}
                                    <div className="flex items-center gap-1 text-zinc-400 shrink-0">
                                        {isCopied ? (
                                            <span className="flex items-center gap-1 text-[11px] text-emerald-400 font-medium">
                                                <Check className="h-3.5 w-3.5" /> 已复制
                                            </span>
                                        ) : isSelected ? (
                                            <span className="flex items-center gap-1 text-[10px] text-indigo-200 bg-indigo-950/80 px-2 py-0.5 rounded border border-indigo-700/60">
                                                回车复制 <CornerDownLeft className="h-2.5 w-2.5" />
                                            </span>
                                        ) : null}
                                    </div>
                                </div>
                            )
                        })
                    )
                ) : (
                    filteredCommands.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-48 text-zinc-500 text-xs">
                            <Search className="h-8 w-8 mb-2 opacity-30" />
                            未匹配到可用命令或端口
                        </div>
                    ) : (
                        filteredCommands.map((cmd, index) => {
                            const isSelected = selectedIndex === index

                            return (
                                <div
                                    key={cmd.id}
                                    data-index={index}
                                    onClick={() => cmd.action()}
                                    onMouseEnter={() => setSelectedIndex(index)}
                                    className={`px-3 py-2.5 rounded-xl flex items-center justify-between gap-3 cursor-pointer transition-all duration-100 ${
                                        isSelected
                                            ? 'bg-violet-600/30 border border-violet-500/50 shadow-inner text-white'
                                            : 'hover:bg-zinc-800/60 border border-transparent text-zinc-300'
                                    }`}
                                >
                                    <div className="flex items-center gap-3 min-w-0 flex-1">
                                        <div className="w-8 h-8 rounded-lg bg-zinc-800/90 border border-zinc-700/60 flex items-center justify-center shrink-0">
                                            {cmd.icon}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2">
                                                <p className={`text-xs font-semibold line-clamp-1 ${
                                                    isSelected ? 'text-white' : 'text-zinc-100'
                                                }`}>
                                                    {cmd.title}
                                                </p>
                                                <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-medium border ${
                                                    cmd.isConflict
                                                        ? 'bg-rose-950/80 text-rose-300 border-rose-700/60'
                                                        : 'bg-zinc-800/80 text-zinc-300 border-zinc-700/50'
                                                }`}>
                                                    {cmd.category}
                                                </span>
                                            </div>
                                            <p className={`text-[11px] mt-0.5 line-clamp-1 ${
                                                cmd.isConflict ? 'text-rose-400 font-medium' : 'text-zinc-400'
                                            }`}>
                                                {cmd.subtitle}
                                            </p>
                                        </div>
                                    </div>

                                    {/* 右侧动作区：Kill 快捷按钮与回车打开 */}
                                    <div className="flex items-center gap-2 shrink-0">
                                        {cmd.secondaryAction && (
                                            <button
                                                type="button"
                                                onClick={(e) => {
                                                    e.stopPropagation()
                                                    cmd.secondaryAction?.()
                                                }}
                                                className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-lg font-medium bg-rose-500/20 hover:bg-rose-600 hover:text-white text-rose-300 border border-rose-500/40 transition-all shadow-xs cursor-pointer"
                                                title="释放该端口 (快捷键: ⌘⌫ / ⌥⌫)"
                                            >
                                                <Skull className="h-3 w-3" />
                                                {cmd.secondaryLabel || 'Kill'}
                                            </button>
                                        )}

                                        {isSelected && (
                                            <span className="flex items-center gap-1 text-[10px] text-violet-200 bg-violet-950/80 px-2 py-0.5 rounded border border-violet-700/60">
                                                回车执行 <CornerDownLeft className="h-2.5 w-2.5" />
                                            </span>
                                        )}
                                    </div>
                                </div>
                            )
                        })
                    )
                )}
            </div>

            {/* 底部按键提示栏 */}
            <div className="px-3.5 py-2 border-t border-white/10 bg-zinc-950/90 flex items-center justify-between text-[10px] text-zinc-400 shrink-0 font-mono">
                <div className="flex items-center gap-3">
                    <span><kbd className="px-1 py-0.5 rounded bg-zinc-800 text-zinc-300">↑↓</kbd> 切换光标</span>
                    <span><kbd className="px-1 py-0.5 rounded bg-zinc-800 text-zinc-300">Enter</kbd> {mode === 'clipboard' ? '复制并填入' : '执行指令'}</span>
                    {mode === 'command' && filteredCommands[selectedIndex]?.secondaryAction && (
                        <span><kbd className="px-1 py-0.5 rounded bg-rose-950 text-rose-300 border border-rose-800/60">⌘⌫</kbd> Kill 释放端口</span>
                    )}
                    <span><kbd className="px-1 py-0.5 rounded bg-zinc-800 text-zinc-300">Tab</kbd> 切换模式</span>
                    {mode === 'clipboard' && !query && (
                        <span><kbd className="px-1 py-0.5 rounded bg-zinc-800 text-zinc-300">1-9</kbd> 快捷选用</span>
                    )}
                </div>
                <div className="flex items-center gap-1">
                    <span><kbd className="px-1 py-0.5 rounded bg-zinc-800 text-zinc-300">Esc</kbd> 关闭</span>
                </div>
            </div>
        </div>
    )
}
