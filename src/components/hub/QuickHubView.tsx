import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { invoke, convertFileSrc } from '@tauri-apps/api/core'
import { LogicalSize } from '@tauri-apps/api/dpi'
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
    Clipboard,
    Timer,
    MonitorPlay,
    Lock,
    Skull,
    AlertTriangle,
    Loader2,
    ScanText
} from 'lucide-react'
import { allTools as launchableTools, resolveToolNav, toolboxTools } from '@/lib/toolCatalog'
import { getActiveAiConfig, DEFAULT_OCR_PROMPT } from '@/components/AiProviderSettings'

type HubMode = 'clipboard' | 'command' | 'ocr'
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

    // OCR 识别状态
    const [ocrPhase, setOcrPhase] = useState<'running' | 'done' | 'error'>('running')
    const [ocrText, setOcrText] = useState('')
    const [ocrError, setOcrError] = useState('')
    const ocrRunIdRef = useRef(0)
    const ocrStartGuardRef = useRef(0)
    const ocrRunningRef = useRef(false)

    // 窗口显示瞬间先留白，等模式就绪再渲染，避免闪出上一次的列表
    const [armed, setArmed] = useState(false)

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
            window.dispatchEvent(new CustomEvent('navigate-to-tool', { detail: { toolId } }))
        } else {
            window.dispatchEvent(new CustomEvent('navigate-to-page', { detail: { page } }))
        }
    }, [])

    // 现场识别剪贴板图片：结果写回剪贴板，由用户手动 ⌘V 粘贴
    const runOcr = useCallback(async () => {
        // 焦点查询与事件派发可能双触发，800ms 内去重
        const now = Date.now()
        if (now - ocrStartGuardRef.current < 800) return
        ocrStartGuardRef.current = now

        const runId = ++ocrRunIdRef.current
        const isCurrent = () => ocrRunIdRef.current === runId
        ocrRunningRef.current = true
        const fail = (msg: string) => {
            if (!isCurrent()) return
            ocrRunningRef.current = false
            setOcrPhase('error')
            setOcrError(msg)
        }

        const aiCfg = getActiveAiConfig()
        if (!aiCfg) {
            fail('请先在「设置 → AI 供应商」中配置 API Key')
            return
        }
        setOcrPhase('running')
        setOcrText('')
        setOcrError('')

        try {
            const current = await invoke<{ dataUrl: string; hash: string } | null>('clipboard_get_current_image')
            if (!isCurrent()) return
            if (!current) {
                fail('剪贴板中没有图片')
                return
            }

            const { config } = aiCfg
            const res = await window.api.ai.chatCompletion({
                baseUrl: config.baseUrl,
                apiKey: config.apiKey,
                model: config.visionModel?.trim() || config.model,
                messages: [{
                    role: 'user',
                    content: [
                        { type: 'text', text: config.ocrPrompt?.trim() || DEFAULT_OCR_PROMPT },
                        { type: 'image_url', image_url: { url: current.dataUrl } },
                    ],
                }],
                temperature: 0,
                source: 'ocr',
                imageHash: current.hash,
                enableThinking: false,
            })
            if (!isCurrent()) return

            const text: string = (res?.choices?.[0]?.message?.content || '').trim()
            if (!text) {
                fail('模型未返回识别内容')
                return
            }

            const ok = await invoke<boolean>('clipboard_set_text', { content: text })
            if (!isCurrent()) return
            if (!ok) {
                fail('写回剪贴板失败')
                return
            }

            ocrRunningRef.current = false
            setOcrPhase('done')
            setOcrText(text)
            setTimeout(() => {
                if (!isCurrent()) return
                // 收起所有 EVA 窗口并把焦点还给原应用，避免识别完主窗口抢焦点
                void invoke('hub_hide_all').catch(() => handleClose())
            }, 1400)
        } catch (e: any) {
            fail(String(e?.message || e || '识别失败'))
        }
    }, [handleClose])

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

    // 统一应用 HUB 模式（事件与焦点两条触发路径共用）
    const applyHubMode = useCallback((target: HubMode) => {
        setArmed(true)
        if (target === 'ocr') {
            setMode('ocr')
            // 事件与焦点两条触发路径可能相隔超过去重窗口，进行中一律不重复发起
            if (!ocrRunningRef.current) void runOcr()
        } else {
            setMode(target)
            setQuery('')
            setSelectedIndex(0)
            if (target === 'clipboard') {
                fetchClips()
            }
            setTimeout(() => {
                inputRef.current?.focus()
                inputRef.current?.select()
            }, 50)
        }
        // 状态就绪后再让 Rust 显示窗口，避免空白/旧界面闪现
        setTimeout(() => {
            void invoke('hub_reveal').catch(() => {})
        }, 0)
    }, [fetchClips, runOcr])

    // 监听后端模式派发 (Option+V -> clipboard, Option+K -> command, Option+O/⌘⇧; -> ocr)
    useEffect(() => {
        const unlistenPromise = listen<string>('eva://hub-mode', (event) => {
            applyHubMode(event.payload === 'ocr' ? 'ocr' : event.payload === 'command' ? 'command' : 'clipboard')
        })

        // 默认初始化拉一次剪贴板
        fetchClips()

        return () => {
            unlistenPromise.then(unlisten => unlisten())
        }
    }, [applyHubMode, fetchClips])

    // 获得焦点时向后端查询当前模式兜底（事件输给首帧渲染时也不会显示旧界面）
    useEffect(() => {
        let cancelled = false
        let unlisten: (() => void) | null = null
        void getCurrentWindow().onFocusChanged(({ payload: focused }) => {
            if (cancelled) return
            if (!focused) {
                setArmed(false)
                return
            }
            void invoke<number>('hub_get_mode')
                .then(m => {
                    if (!cancelled) applyHubMode(m === 3 ? 'ocr' : m === 2 ? 'command' : 'clipboard')
                })
                .catch(() => setArmed(true))
        }).then(fn => {
            if (cancelled) fn()
            else unlisten = fn
        })
        return () => {
            cancelled = true
            if (unlisten) unlisten()
        }
    }, [applyHubMode])

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

    // OCR 模式收窄窗口高度，避免大片空白；其余模式恢复默认
    useEffect(() => {
        const height = mode !== 'ocr' ? 480 : ocrPhase === 'done' ? 340 : 208
        const win = getCurrentWindow()
        void win.setSize(new LogicalSize(640, height))
            .then(() => (mode === 'ocr' ? win.center() : Promise.resolve()))
            .catch(() => {})
    }, [mode, ocrPhase])

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


        // 3. 常用工具箱直达
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
                    action: () => {
                        void navigateMainTo('toolbox', tool.id)
                    }
                })
            }
        })

        // 3b. 侧栏诊断工具（也可从工具语义搜到）
        launchableTools
            .filter((t) => t.nav)
            .forEach((tool) => {
                const matchTitle = tool.title.toLowerCase().includes(trimmed)
                const matchDesc = tool.description.toLowerCase().includes(trimmed)
                const matchId = tool.id.toLowerCase().includes(trimmed)
                if (!trimmed || matchTitle || matchDesc || matchId) {
                    list.push({
                        id: `diag-${tool.id}`,
                        category: '实用工具',
                        title: tool.title,
                        subtitle: tool.description,
                        icon: <Wrench className="h-4 w-4 text-emerald-400" />,
                        action: () => {
                            const nav = resolveToolNav(tool.id)
                            if (nav) void navigateMainTo(nav)
                        }
                    })
                }
            })

        // 4. 核心页面导航
        const navList = [
            { id: 'dashboard', title: '仪表盘', subtitle: '概览、时间活跃与 EVA 智能副驾', icon: <LayoutDashboard className="h-4 w-4 text-blue-400" /> },
            { id: 'navigation', title: '网站导航', subtitle: '分类书签与常用工具链站点', icon: <Compass className="h-4 w-4 text-indigo-400" /> },
            { id: 'localports', title: '本地监听端口', subtitle: '查看本机端口占用与进程', icon: <Radio className="h-4 w-4 text-sky-400" /> },
            { id: 'memory', title: '内存分析', subtitle: '进程树聚合，识别内存刺客', icon: <Monitor className="h-4 w-4 text-emerald-400" /> },
            { id: 'envdetector', title: '环境探测', subtitle: '本机开发工具版本与路径', icon: <Code className="h-4 w-4 text-teal-400" /> },
            { id: 'toolbox', title: '全部工具箱', subtitle: 'JSON、密码、SQL 等实用小工具', icon: <Wrench className="h-4 w-4 text-violet-400" /> },
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

    // 刚唤出、模式尚未就绪：先渲染深色卡片壳 + 小号加载符，避免整窗空白
    if (!armed) {
        return (
            <div className="w-full h-screen flex items-center justify-center rounded-2xl border border-white/10 bg-[#16161a] shadow-2xl backdrop-blur-2xl">
                <Loader2 className="h-4 w-4 animate-spin text-zinc-500" />
            </div>
        )
    }

    return (
        <div 
            className="w-full h-screen flex flex-col select-none overflow-hidden rounded-2xl border border-white/10 bg-[#16161a] text-zinc-100 shadow-2xl backdrop-blur-2xl"
            onKeyDown={handleKeyDown}
        >
            {/* 顶部搜索与模式胶囊栏 */}
            <div className="p-3.5 border-b border-white/10 flex items-center gap-2.5 bg-zinc-900/90 shrink-0">
                <div className="flex items-center gap-2 text-zinc-400 pl-1">
                    {mode === 'ocr' ? (
                        <ScanText className="h-5 w-5 text-amber-400 animate-in zoom-in-75 duration-150" />
                    ) : mode === 'clipboard' ? (
                        <ClipboardList className="h-5 w-5 text-indigo-400 animate-in zoom-in-75 duration-150" />
                    ) : (
                        <Search className="h-5 w-5 text-violet-400 animate-in zoom-in-75 duration-150" />
                    )}
                </div>

                {mode === 'ocr' ? (
                    <span className="flex-1 text-sm text-zinc-200 font-medium pl-1">剪贴板图片 AI 识别</span>
                ) : (
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
                )}

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
                {mode === 'ocr' ? (
                    <div className="h-full flex flex-col justify-center gap-2.5 px-5 py-4 min-h-0">
                        {ocrPhase === 'running' && (
                            <div className="flex items-center justify-center gap-2.5">
                                <Loader2 className="h-4 w-4 animate-spin text-amber-400 shrink-0" />
                                <span className="text-sm text-zinc-300">正在识别剪贴板图片…</span>
                            </div>
                        )}
                        {ocrPhase === 'done' && (
                            <>
                                <div className="flex items-center gap-2 shrink-0">
                                    <Check className="h-4 w-4 text-emerald-400 shrink-0" />
                                    <span className="text-xs text-zinc-300">已写入剪贴板，切回原应用 ⌘V 粘贴</span>
                                </div>
                                <p className="text-xs font-mono text-zinc-400 whitespace-pre-wrap break-all overflow-y-auto min-h-0">
                                    {ocrText}
                                </p>
                            </>
                        )}
                        {ocrPhase === 'error' && (
                            <div className="flex items-center justify-center gap-2.5">
                                <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0" />
                                <span className="text-sm text-zinc-300">{ocrError}</span>
                            </div>
                        )}
                    </div>
                ) : mode === 'clipboard' ? (
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
                    {mode === 'ocr' ? (
                        <span>识别完成后自动隐藏，切回原应用直接 <kbd className="px-1 py-0.5 rounded bg-zinc-800 text-zinc-300">⌘V</kbd> 粘贴</span>
                    ) : (
                    <>
                        <span><kbd className="px-1 py-0.5 rounded bg-zinc-800 text-zinc-300">↑↓</kbd> 切换光标</span>
                        <span><kbd className="px-1 py-0.5 rounded bg-zinc-800 text-zinc-300">Enter</kbd> {mode === 'clipboard' ? '复制并填入' : '执行指令'}</span>
                        {mode === 'command' && filteredCommands[selectedIndex]?.secondaryAction && (
                            <span><kbd className="px-1 py-0.5 rounded bg-rose-950 text-rose-300 border border-rose-800/60">⌘⌫</kbd> Kill 释放端口</span>
                        )}
                        <span><kbd className="px-1 py-0.5 rounded bg-zinc-800 text-zinc-300">Tab</kbd> 切换模式</span>
                        {mode === 'clipboard' && !query && (
                            <span><kbd className="px-1 py-0.5 rounded bg-zinc-800 text-zinc-300">1-9</kbd> 快捷选用</span>
                        )}
                    </>
                    )}
                </div>
                <div className="flex items-center gap-1">
                    <span><kbd className="px-1 py-0.5 rounded bg-zinc-800 text-zinc-300">Esc</kbd> 关闭</span>
                </div>
            </div>
        </div>
    )
}
