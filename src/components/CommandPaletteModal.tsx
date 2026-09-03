import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import {
    Search,
    Radio,
    Wrench,
    Compass,
    Server,
    Clipboard,
    Timer,
    MonitorPlay,
    Lock,
    Settings,
    LayoutDashboard,
    ExternalLink,
    Skull,
    Copy,
    Check,
    Calculator,
    CornerDownLeft,
    Sparkles,
    Globe,
    Code,
    Key,
    Database,
    Cpu,
    Pipette,
    Combine
} from 'lucide-react'
import { NavItem } from '@/components/layout/Sidebar'
import { tools as toolboxTools } from '@/pages/ToolboxPage'

interface ListeningPort {
    protocol: 'tcp' | 'udp'
    localAddress: string
    port: number
    pid: number
    processName: string
    command?: string
}

interface PaletteItem {
    id: string
    category: 'port' | 'calc' | 'tool' | 'nav' | 'clip'
    categoryLabel: string
    title: string
    subtitle?: string
    icon: React.ReactNode
    action: () => void | Promise<void>
    actionLabel?: string
    secondaryAction?: () => void | Promise<void>
    secondaryActionLabel?: string
}

export function CommandPaletteModal(): React.ReactElement | null {
    const [open, setOpen] = useState(false)
    const [query, setQuery] = useState('')
    const [selectedIndex, setSelectedIndex] = useState(0)
    const [ports, setPorts] = useState<ListeningPort[]>([])
    const [clipItems, setClipItems] = useState<any[]>([])
    const [toastMessage, setToastMessage] = useState<string | null>(null)
    const inputRef = useRef<HTMLInputElement>(null)
    const listRef = useRef<HTMLDivElement>(null)

    // 显示临时提示
    const showToast = (msg: string) => {
        setToastMessage(msg)
        setTimeout(() => setToastMessage(null), 1800)
    }

    // 全局快捷键监听 Command + K
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
                e.preventDefault()
                setOpen(prev => {
                    const next = !prev
                    if (next) {
                        setQuery('')
                        setSelectedIndex(0)
                    }
                    return next
                })
            } else if (e.key === 'Escape' && open) {
                e.preventDefault()
                setOpen(false)
            }
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [open])

    // 打开时自动聚焦并抓取端口列表
    useEffect(() => {
        if (open) {
            setTimeout(() => {
                inputRef.current?.focus()
            }, 50)

            // 拉取本地监听端口
            if (window.api?.getListeningPorts) {
                window.api.getListeningPorts().then((res: ListeningPort[]) => {
                    setPorts(res || [])
                }).catch(() => {})
            }
        }
    }, [open])

    // 监听剪贴板搜索防抖
    useEffect(() => {
        if (!open || !query.trim() || query.length < 2) {
            setClipItems([])
            return
        }

        const timer = setTimeout(() => {
            if (window.api?.clipboard?.searchItems) {
                window.api.clipboard.searchItems(query.trim(), 4).then((res: any[]) => {
                    setClipItems(res || [])
                }).catch(() => {})
            }
        }, 150)

        return () => clearTimeout(timer)
    }, [open, query])

    // 页面跳转动作
    const navigateTo = useCallback((page: NavItem) => {
        setOpen(false)
        window.dispatchEvent(new CustomEvent('navigate-to-page', {
            detail: { page }
        }))
    }, [])

    // 工具箱跳转动作
    const openTool = useCallback((toolId: string) => {
        setOpen(false)
        window.dispatchEvent(new CustomEvent('navigate-to-tool', {
            detail: { toolId }
        }))
    }, [])

    // 杀死进程
    const killProcess = useCallback(async (pid: number, port: number) => {
        try {
            if (window.api?.killProcess) {
                const res = await window.api.killProcess(pid)
                if (res.success) {
                    showToast(`已终止 PID ${pid} (释放端口 ${port})`)
                    // 重新获取端口列表
                    const updated = await window.api.getListeningPorts()
                    setPorts(updated || [])
                }
            }
        } catch (e) {
            console.error('Kill process failed:', e)
        }
    }, [])

    // 聚合计算候选条目
    const items = useMemo<PaletteItem[]>(() => {
        const list: PaletteItem[] = []
        const trimmed = query.trim().toLowerCase()

        // 1. 即时数学算式计算器
        if (/^[\d\s+\-*/%().^]+$/.test(trimmed) && trimmed.length >= 2) {
            try {
                // 安全计算纯四则运算
                // eslint-disable-next-line no-eval
                const result = Function(`'use strict'; return (${trimmed})`)()
                if (typeof result === 'number' && !isNaN(result)) {
                    list.push({
                        id: `calc-${result}`,
                        category: 'calc',
                        categoryLabel: '速算结果',
                        title: `${result}`,
                        subtitle: `表达式: ${query.trim()}`,
                        icon: <Calculator className="h-4 w-4 text-amber-500" />,
                        actionLabel: '复制结果',
                        action: async () => {
                            await navigator.clipboard.writeText(String(result))
                            showToast(`已复制: ${result}`)
                            setOpen(false)
                        }
                    })
                }
            } catch {}
        }

        // 2. 端口探测与直达 (输入数字 或 输入 port / 端口)
        const isPortQuery = /^\d+$/.test(trimmed) || trimmed.includes('port') || trimmed.includes('端口')
        const targetNum = trimmed.replace(/\D/g, '')

        ports.forEach(p => {
            const portStr = String(p.port)
            const matchesNumber = targetNum ? portStr.includes(targetNum) : false
            const matchesText = trimmed ? p.processName.toLowerCase().includes(trimmed) : false

            if ((isPortQuery && (!targetNum || matchesNumber)) || matchesText || (trimmed === 'port') || (trimmed === '端口')) {
                list.push({
                    id: `port-${p.port}-${p.pid}`,
                    category: 'port',
                    categoryLabel: '本地监听端口',
                    title: `端口 ${p.port} (${p.processName})`,
                    subtitle: `PID: ${p.pid} · 绑定: ${p.localAddress} ${p.command ? `· ${p.command}` : ''}`,
                    icon: <Radio className="h-4 w-4 text-emerald-500 animate-pulse" />,
                    actionLabel: '浏览器打开',
                    action: async () => {
                        setOpen(false)
                        if (window.api?.openInBrowser) {
                            await window.api.openInBrowser(`http://localhost:${p.port}`)
                        } else {
                            window.open(`http://localhost:${p.port}`, '_blank')
                        }
                    },
                    secondaryActionLabel: 'Kill 进程',
                    secondaryAction: () => killProcess(p.pid, p.port)
                })
            }
        })

        // 3. 常用工具箱直达
        toolboxTools.forEach(tool => {
            const matchTitle = tool.title.toLowerCase().includes(trimmed)
            const matchDesc = tool.description.toLowerCase().includes(trimmed)
            const matchId = tool.id.toLowerCase().includes(trimmed)

            if (!trimmed || matchTitle || matchDesc || matchId) {
                list.push({
                    id: `tool-${tool.id}`,
                    category: 'tool',
                    categoryLabel: '实用工具',
                    title: tool.title,
                    subtitle: tool.description,
                    icon: <Wrench className="h-4 w-4 text-violet-500" />,
                    actionLabel: '打开工具',
                    action: () => openTool(tool.id)
                })
            }
        })

        // 4. 侧边栏全域导航
        const navList: { id: NavItem; title: string; subtitle: string; icon: React.ReactNode }[] = [
            { id: 'dashboard', title: '仪表盘', subtitle: '概览、时间活跃与 EVA 智能副驾', icon: <LayoutDashboard className="h-4 w-4 text-blue-500" /> },
            { id: 'navigation', title: '网站导航', subtitle: '分类书签与常用工具链站点', icon: <Compass className="h-4 w-4 text-indigo-500" /> },
            { id: 'services', title: '本地服务', subtitle: '本地微服务管理与启停控制', icon: <Server className="h-4 w-4 text-emerald-500" /> },
            { id: 'toolbox', title: '全部工具箱', subtitle: '端口、环境、密码与各类开发者瑞士军刀', icon: <Wrench className="h-4 w-4 text-violet-500" /> },
            { id: 'clipboard', title: '剪贴板历史', subtitle: '富媒体剪贴记录与模糊全文搜索', icon: <Clipboard className="h-4 w-4 text-amber-500" /> },
            { id: 'timeauditor', title: '时间审计看板', subtitle: '全天工作时长、工程投入占比与热力流', icon: <Timer className="h-4 w-4 text-pink-500" /> },
            { id: 'visualrecall', title: '视觉回溯', subtitle: '工作记忆快照与时间旅行回放', icon: <MonitorPlay className="h-4 w-4 text-cyan-500" /> },
            { id: 'vault', title: '加密保险箱', subtitle: 'Touch ID 与敏感凭据保险库', icon: <Lock className="h-4 w-4 text-rose-500" /> },
            { id: 'settings', title: '系统设置', subtitle: '全局快捷键、模型 API 与个性化外观', icon: <Settings className="h-4 w-4 text-zinc-500" /> },
        ]

        navList.forEach(n => {
            if (!trimmed || n.title.toLowerCase().includes(trimmed) || n.subtitle.toLowerCase().includes(trimmed) || n.id.includes(trimmed)) {
                list.push({
                    id: `nav-${n.id}`,
                    category: 'nav',
                    categoryLabel: '页面跳转',
                    title: n.title,
                    subtitle: n.subtitle,
                    icon: n.icon,
                    actionLabel: '前往页面',
                    action: () => navigateTo(n.id)
                })
            }
        })

        // 5. 剪贴板实时检索结果
        clipItems.forEach(c => {
            list.push({
                id: `clip-${c.id}`,
                category: 'clip',
                categoryLabel: '剪贴板历史',
                title: c.preview?.slice(0, 50) || c.content?.slice(0, 50) || '[剪贴内容]',
                subtitle: `${c.sourceApp || '系统'} · 点击重新复制`,
                icon: <Clipboard className="h-4 w-4 text-blue-400" />,
                actionLabel: '写回剪贴板',
                action: async () => {
                    if (window.api?.clipboard?.writeToClipboard) {
                        await window.api.clipboard.writeToClipboard(c.id)
                    } else {
                        await navigator.clipboard.writeText(c.content)
                    }
                    showToast('已写回系统剪贴板')
                    setOpen(false)
                }
            })
        })

        return list
    }, [query, ports, clipItems, navigateTo, openTool, killProcess])

    // 当列表变动时保证选中索引有效
    useEffect(() => {
        setSelectedIndex(0)
    }, [items.length, query])

    // 键盘导航选择
    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (items.length === 0) return

        if (e.key === 'ArrowDown') {
            e.preventDefault()
            setSelectedIndex(prev => (prev + 1) % items.length)
        } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setSelectedIndex(prev => (prev - 1 + items.length) % items.length)
        } else if (e.key === 'Enter') {
            e.preventDefault()
            const activeItem = items[selectedIndex]
            if (activeItem) {
                activeItem.action()
            }
        }
    }

    // 保持高亮项可见
    useEffect(() => {
        if (!listRef.current) return
        const activeElement = listRef.current.querySelector(`[data-index="${selectedIndex}"]`)
        if (activeElement) {
            activeElement.scrollIntoView({ block: 'nearest' })
        }
    }, [selectedIndex])

    if (!open) return null

    return (
        <div 
            className="fixed inset-0 z-50 flex items-start justify-center pt-[14vh] bg-black/40 dark:bg-black/60 backdrop-blur-sm animate-in fade-in duration-150"
            onClick={() => setOpen(false)}
        >
            <div 
                className="w-[620px] max-w-[92vw] overflow-hidden rounded-2xl border border-white/70 dark:border-white/10 shadow-[0_24px_70px_rgba(0,0,0,0.25)] select-none animate-in zoom-in-95 duration-150"
                style={{
                    background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.94) 0%, rgba(248, 250, 252, 0.9) 100%)',
                    backdropFilter: 'blur(30px)',
                    WebkitBackdropFilter: 'blur(30px)'
                }}
                onClick={e => e.stopPropagation()}
            >
                {/* 顶部搜索栏 */}
                <div className="flex items-center px-4 py-3.5 border-b border-zinc-200/60 dark:border-zinc-800/60 gap-3">
                    <Search className="h-5 w-5 text-violet-500 shrink-0" />
                    <input
                        ref={inputRef}
                        type="text"
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="输入端口号、进程、工具名、算式或检索剪贴板..."
                        className="flex-1 bg-transparent text-sm text-zinc-800 dark:text-zinc-100 placeholder-zinc-400 outline-none border-none font-medium"
                    />
                    <kbd className="px-2 py-0.5 rounded text-[11px] font-mono text-zinc-400 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700">
                        ESC
                    </kbd>
                </div>

                {/* 结果列表 */}
                <div 
                    ref={listRef}
                    className="max-h-[380px] overflow-y-auto p-2 space-y-1 divide-y divide-transparent"
                >
                    {items.length === 0 ? (
                        <div className="py-12 text-center text-xs text-zinc-400">
                            未匹配到任何端口、工具或命令
                        </div>
                    ) : (
                        items.map((item, idx) => {
                            const isSelected = idx === selectedIndex

                            return (
                                <div
                                    key={item.id}
                                    data-index={idx}
                                    onClick={() => item.action()}
                                    onMouseEnter={() => setSelectedIndex(idx)}
                                    className={`group flex items-center justify-between px-3 py-2.5 rounded-xl cursor-pointer transition-all duration-150 ${
                                        isSelected 
                                            ? 'bg-violet-600 text-white shadow-md' 
                                            : 'hover:bg-zinc-100/70 dark:hover:bg-zinc-800/50 text-zinc-700 dark:text-zinc-200'
                                    }`}
                                >
                                    <div className="flex items-center gap-3 min-w-0 flex-1">
                                        <div className={`p-1.5 rounded-lg shrink-0 transition-colors ${
                                            isSelected 
                                                ? 'bg-white/25 text-white [&_svg]:!text-white shadow-xs' 
                                                : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300'
                                        }`}>
                                            {item.icon}
                                        </div>

                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2">
                                                <span className="text-xs font-semibold truncate">
                                                    {item.title}
                                                </span>
                                                <span className={`text-[10px] px-1.5 py-0.2 rounded font-medium ${
                                                    isSelected 
                                                        ? 'bg-white/20 text-white/90' 
                                                        : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400'
                                                }`}>
                                                    {item.categoryLabel}
                                                </span>
                                            </div>

                                            {item.subtitle && (
                                                <p className={`text-[11px] truncate mt-0.5 ${
                                                    isSelected ? 'text-white/80' : 'text-zinc-400 dark:text-zinc-500'
                                                }`}>
                                                    {item.subtitle}
                                                </p>
                                            )}
                                        </div>
                                    </div>

                                    {/* 快捷操作区 */}
                                    <div className="flex items-center gap-2 shrink-0 pl-3">
                                        {item.secondaryAction && (
                                            <button
                                                onClick={e => {
                                                    e.stopPropagation()
                                                    item.secondaryAction?.()
                                                }}
                                                className={`text-[10px] px-2 py-1 rounded-md font-medium transition-all ${
                                                    isSelected 
                                                        ? 'bg-rose-500 hover:bg-rose-600 text-white shadow-xs' 
                                                        : 'bg-rose-50 hover:bg-rose-100 text-rose-600 dark:bg-rose-950/40 dark:text-rose-300'
                                                }`}
                                                title="释放该端口"
                                            >
                                                {item.secondaryActionLabel || 'Kill'}
                                            </button>
                                        )}

                                        <div className={`flex items-center gap-1 text-[11px] font-medium ${
                                            isSelected ? 'text-white/90 [&_svg]:!text-white' : 'text-zinc-400 group-hover:text-violet-600'
                                        }`}>
                                            <span>{item.actionLabel || '选择'}</span>
                                            <CornerDownLeft className="h-3 w-3" />
                                        </div>
                                    </div>
                                </div>
                            )
                        })
                    )}
                </div>

                {/* 底部按键提示栏 */}
                <div className="px-4 py-2 border-t border-zinc-200/50 dark:border-zinc-800/50 flex items-center justify-between text-[11px] text-zinc-400 bg-zinc-50/50 dark:bg-zinc-900/50">
                    <div className="flex items-center gap-3">
                        <span className="flex items-center gap-1">
                            <kbd className="px-1.5 py-0.5 rounded bg-zinc-200/60 dark:bg-zinc-800 font-mono text-[10px]">↑↓</kbd>
                            <span>移动</span>
                        </span>
                        <span className="flex items-center gap-1">
                            <kbd className="px-1.5 py-0.5 rounded bg-zinc-200/60 dark:bg-zinc-800 font-mono text-[10px]">↵</kbd>
                            <span>打开 / 执行</span>
                        </span>
                        <span className="flex items-center gap-1">
                            <kbd className="px-1.5 py-0.5 rounded bg-zinc-200/60 dark:bg-zinc-800 font-mono text-[10px]">ESC</kbd>
                            <span>关闭</span>
                        </span>
                    </div>

                    <div className="flex items-center gap-1 text-violet-500 font-medium">
                        <Sparkles className="h-3 w-3" />
                        <span>EVA Command</span>
                    </div>
                </div>
            </div>

            {/* 提示消息 Toast */}
            {toastMessage && (
                <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-60 px-4 py-2 rounded-full bg-zinc-900/90 text-white text-xs font-medium shadow-lg backdrop-blur animate-in fade-in duration-200 flex items-center gap-2">
                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                    <span>{toastMessage}</span>
                </div>
            )}
        </div>
    )
}
