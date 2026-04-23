import React, { useState, useRef, useEffect } from 'react'
import { CodeHighlighter } from '@ant-design/x'
import XMarkdown from '@ant-design/x-markdown'
import { Check, Copy, Volume2, Square, Loader2 } from 'lucide-react'
import { SourceInfo } from '../../hooks/useChatSessions'
import { parseThinkingContent } from '../../lib/chat-utils'

/**
 * 代码块组件 - 使用 CodeHighlighter 渲染
 * 只处理 pre > code 结构的代码块
 */
export function CodeBlockWrapper({ children }: { children?: React.ReactNode }) {
    // 从 children 中提取 code 元素的内容
    const codeElement = children as React.ReactElement
    if (!codeElement?.props) {
        return <pre>{children}</pre>
    }

    const code = codeElement.props.children || ''
    const className = codeElement.props.className || ''
    const lang = className.replace('language-', '') || 'text'

    return (
        <div className="my-3 overflow-hidden rounded-lg border bg-zinc-50">
            <div className="flex items-center justify-between bg-zinc-100 px-4 py-2">
                <span className="text-[11px] font-medium text-zinc-600 uppercase tracking-tight">{lang}</span>
                <button
                    className="text-[11px] text-zinc-500 hover:text-zinc-700 transition-colors px-1.5 py-0.5 rounded hover:bg-zinc-200"
                    onClick={() => navigator.clipboard.writeText(String(code))}
                >
                    复制
                </button>
            </div>
            <CodeHighlighter lang={lang} style={{ margin: 0, borderRadius: 0 }}>
                {String(code)}
            </CodeHighlighter>
        </div>
    )
}

/**
 * 内联代码组件
 */
export function InlineCode({ children }: { children?: React.ReactNode }) {
    return (
        <code className="rounded bg-zinc-100 px-1 py-0.5 text-[11px] font-mono text-zinc-800 dark:bg-zinc-800 dark:text-zinc-300">
            {children}
        </code>
    )
}

/**
 * 带有 Obsidian 链接的 Markdown 渲染包装器
 */
export function MarkdownWithObsidianLinks({
    content,
    components,
    style
}: {
    content: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    components: any
    style: React.CSSProperties
}) {
    const containerRef = useRef<HTMLDivElement>(null)

    // 过滤掉底部的“参考来源：”列表，因为它已经由底部的 SourceLinkButton 显示了
    // 使用正则匹配，且不区分大小写，支持中英文冒号
    const cleanContent = content.split(/参考来源[：:]/i)[0].trim()

    // 将来源标记转换为特殊格式的 Markdown 链接
    const processedContent = cleanContent.replace(
        /【来源:\s*([^】]+)】/g,
        (_, fileName) => {
            const trimmedName = fileName.trim()
            // 判断是否为绝对路径（简单判断：以 / 开头或包含 \）
            const isAbsolutePath = trimmedName.startsWith('/') || trimmedName.includes('\\')

            if (isAbsolutePath) {
                const displayName = trimmedName.split(/[/\\]/).pop() || trimmedName
                // 使用 file 协议标记普通文件链接
                return `[📁 ${displayName}](file://${encodeURIComponent(trimmedName)})`
            }

            const obsidianPath = trimmedName.replace(/\.md$/, '')
            // 使用 obsidian 协议标记 Obsidian 链接
            return `[📄 ${trimmedName}](obsidian://${encodeURIComponent(obsidianPath)})`
        }
    )

    // 使用事件委托处理链接点击
    useEffect(() => {
        const container = containerRef.current
        if (!container) return

        const handleClick = (e: MouseEvent) => {
            const target = e.target as HTMLElement
            const link = target.closest('a')

            if (link) {
                const href = link.getAttribute('href')
                if (href?.startsWith('obsidian://')) {
                    e.preventDefault()
                    e.stopPropagation()

                    // 提取文件路径
                    const filePath = decodeURIComponent(href.replace('obsidian://', ''))
                    const obsidianUrl = `obsidian://open?file=${encodeURIComponent(filePath)}`

                    // 打开 Obsidian
                    window.open(obsidianUrl, '_blank')
                } else if (href?.startsWith('file://')) {
                    e.preventDefault()
                    e.stopPropagation()

                    // 提取文件路径并调用 Finder 打开
                    const filePath = decodeURIComponent(href.replace('file://', ''))
                    window.api.openInFinder(filePath)
                }
            }
        }

        container.addEventListener('click', handleClick)
        return () => container.removeEventListener('click', handleClick)
    }, [])

    return (
        <div ref={containerRef} className="obsidian-links-container">
            <XMarkdown components={components} style={style}>
                {processedContent}
            </XMarkdown>
        </div>
    )
}

/**
 * 复制按钮组件
 */
export function CopyButton({ content, className = '' }: { content: string; className?: string }) {
    const [copied, setCopied] = useState(false)

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(content)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
        } catch (err) {
            console.error('Failed to copy:', err)
        }
    }

    return (
        <button
            type="button"
            onClick={handleCopy}
            className={`p-1.5 rounded-md hover:bg-muted transition-colors ${className}`}
            title={copied ? '已复制' : '复制内容'}
        >
            {copied ? (
                <Check className="h-3.5 w-3.5 text-green-500" />
            ) : (
                <Copy className="h-3.5 w-3.5 text-muted-foreground" />
            )}
        </button>
    )
}

/**
 * 来源链接按钮组件
 */
export function SourceLinkButton({ fileName }: { fileName: string }) {
    const trimmedName = fileName.trim()
    // 鲁棒性增强：识别 / 开头或 ~ 开头，或者看起来像被截断了开头的绝对路径（如 Users/xxx）
    const isAbsolutePath = trimmedName.startsWith('/') ||
        trimmedName.startsWith('~') ||
        (trimmedName.startsWith('Users/') && !trimmedName.includes(':'))

    // 如果是逻辑上的绝对路径但缺少开头斜杠，补全它
    const correctedPath = (isAbsolutePath && !trimmedName.startsWith('/') && !trimmedName.startsWith('~'))
        ? `/${trimmedName}`
        : trimmedName

    const displayName = isAbsolutePath ? (correctedPath.split(/[/\\]/).pop() || correctedPath) : correctedPath

    const handleClick = () => {
        if (isAbsolutePath) {
            window.api.openInFinder(correctedPath)
        } else {
            // 如果文件名看起来像 PDF 但不是路径，可能还是需要通过 Finder 打开
            if (trimmedName.toLowerCase().endsWith('.pdf')) {
                window.api.openInFinder(correctedPath)
            } else {
                // 移除 .md 扩展名
                const obsidianPath = trimmedName.replace(/\.md$/, '')
                const obsidianUrl = `obsidian://open?file=${encodeURIComponent(obsidianPath)}`
                // 打开 Obsidian
                window.open(obsidianUrl, '_blank')
            }
        }
    }

    // 确定图标
    const icon = (() => {
        const lowerName = trimmedName.toLowerCase()
        if (lowerName.endsWith('.pdf')) return '📄'
        if (lowerName.endsWith('.md')) return '📝'
        const codeExts = ['.py', '.js', '.ts', '.tsx', '.go', '.java', '.c', '.cpp', '.jsx']
        if (codeExts.some(ext => lowerName.endsWith(ext))) return '💻'
        if (isAbsolutePath) return '📁'
        return '📄'
    })()

    return (
        <button
            type="button"
            onClick={handleClick}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-500/5 text-blue-600 dark:text-blue-400 hover:bg-blue-500/10 transition-colors text-[12px] font-medium cursor-pointer border border-blue-500/10 hover:border-blue-500/20"
            title={isAbsolutePath ? `在 Finder 中定位文件: ${correctedPath}` : `在 Obsidian 中打开: ${trimmedName}`}
        >
            <span className="text-[11px]">{icon}</span>
            <span className="max-w-[500px] truncate text-left">{displayName}</span>
        </button>
    )
}

export function TTSButton({ content, className, lang }: { content: string; className?: string; lang?: string }) {
    const [isPlaying, setIsPlaying] = useState(false)
    const [isLoading, setIsLoading] = useState(false)
    const audioRef = useRef<HTMLAudioElement | null>(null)

    const PYTHON_SERVICE_URL = 'http://127.0.0.1:18888'

    // 语言代码到 Edge TTS 声音的映射
    const voiceMap: Record<string, string> = {
        'zh': 'zh-CN-XiaoxiaoNeural',
        'zh-CN': 'zh-CN-XiaoxiaoNeural',
        'zh-TW': 'zh-TW-HsiaoChenNeural',
        'en': 'en-US-JennyNeural',
        'en-US': 'en-US-JennyNeural',
        'en-GB': 'en-GB-SoniaNeural',
        'ja': 'ja-JP-NanamiNeural',
        'ko': 'ko-KR-SunHiNeural',
        'fr': 'fr-FR-DeniseNeural',
        'de': 'de-DE-KatjaNeural',
        'es': 'es-ES-ElviraNeural',
        'pt': 'pt-BR-FranciscaNeural',
        'ru': 'ru-RU-SvetlanaNeural',
        'it': 'it-IT-ElsaNeural',
        'ar': 'ar-SA-ZariyahNeural',
        'th': 'th-TH-PremwadeeNeural',
        'vi': 'vi-VN-HoaiMyNeural',
    }

    // 简单的语言检测函数
    const detectLanguage = (text: string): string => {
        // 检测中文
        if (/[\u4e00-\u9fa5]/.test(text)) return 'zh'
        // 检测日文
        if (/[\u3040-\u309f\u30a0-\u30ff]/.test(text)) return 'ja'
        // 检测韩文
        if (/[\uac00-\ud7af]/.test(text)) return 'ko'
        // 检测阿拉伯文
        if (/[\u0600-\u06ff]/.test(text)) return 'ar'
        // 检测俄文
        if (/[\u0400-\u04ff]/.test(text)) return 'ru'
        // 检测泰文
        if (/[\u0e00-\u0e7f]/.test(text)) return 'th'
        // 检测越南文 (基于特殊字符)
        if (/[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(text)) return 'vi'
        // 默认英文
        return 'en'
    }

    const handlePlay = async () => {
        if (isPlaying && audioRef.current) {
            audioRef.current.pause()
            audioRef.current = null
            setIsPlaying(false)
            return
        }

        setIsLoading(true)
        try {
            // 确定使用哪个声音
            const detectedLang = lang || detectLanguage(content)
            const voice = voiceMap[detectedLang] || voiceMap['en']

            const response = await fetch(`${PYTHON_SERVICE_URL}/tts/speak`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: content,
                    voice,
                    rate: '+0%',
                    volume: '+0%'
                })
            })

            if (!response.ok) {
                throw new Error('TTS 请求失败')
            }

            const audioBlob = await response.blob()
            const audioUrl = URL.createObjectURL(audioBlob)
            const audio = new Audio(audioUrl)
            audioRef.current = audio

            audio.onended = () => {
                setIsPlaying(false)
                audioRef.current = null
                URL.revokeObjectURL(audioUrl)
            }

            audio.onerror = () => {
                setIsPlaying(false)
                audioRef.current = null
                URL.revokeObjectURL(audioUrl)
                console.error('Audio playback error')
            }

            await audio.play()
            setIsPlaying(true)
        } catch (err) {
            console.error('TTS failed:', err)
        } finally {
            setIsLoading(false)
        }
    }

    return (
        <button
            onClick={handlePlay}
            disabled={isLoading}
            className={`p-1.5 rounded-md hover:bg-muted transition-colors ${className}`}
            title={isPlaying ? '停止朗读' : '朗读内容'}
        >
            {isLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : isPlaying ? (
                <Square className="h-3.5 w-3.5 fill-current" />
            ) : (
                <Volume2 className="h-3.5 w-3.5" />
            )}
        </button>
    )
}

/**
 * 消息渲染组件 - 支持思维链和代码高亮
 */
export function MessageContent({
    content,
    isStreaming,
    sources: providedSources // 新增：可选的结构化来源
}: {
    content: string
    isStreaming?: boolean
    sources?: SourceInfo[]
}) {
    // 渲染来源列表（脚注样式）
    const renderSources = (sources: SourceInfo[]) => {
        if (!sources || sources.length === 0) return null

        return (
            <div className="mt-4 border-t pt-2 space-y-1">
                <div className="text-[12px] font-semibold text-muted-foreground mb-2 flex items-center gap-1.5 opacity-80">
                    <span className="h-px flex-1 bg-border/40" />
                    参考来源
                    <span className="h-px flex-1 bg-border/40" />
                </div>
                <div className="flex flex-wrap gap-2">
                    {sources.map((source) => (
                        <SourceLinkButton key={source.index} fileName={source.fileName} />
                    ))}
                </div>
            </div>
        )
    }

    const { thinking, content: finalContent } = parseThinkingContent(content)

    return (
        <div className="space-y-2">
            {/* 思维链部分 - 保留原始 Markdown 渲染 (因为思维链通常不含复杂交互) */}
            {thinking && (
                <div className="mb-2 rounded-xl bg-muted/30 p-3 text-[12px] leading-relaxed text-muted-foreground/80 border border-border/40 backdrop-blur-sm">
                    <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider opacity-50">
                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary/50" />
                        思考过程
                    </div>
                    <XMarkdown>{thinking}</XMarkdown>
                </div>
            )}

            {/* 正文部分 - 使用带 Obsidian 链接支持的 Markdown 渲染 */}
            {finalContent && (
                <MarkdownWithObsidianLinks
                    content={finalContent}
                    components={{
                        pre: CodeBlockWrapper,
                        code: InlineCode
                    }}
                    style={{
                        fontSize: '12px',
                        lineHeight: '1.6',
                        color: 'inherit'
                    }}
                />
            )}

            {/* 如果正在流式传输且所有内容为空（思考中），显示加载动画 */}
            {isStreaming && !thinking && !finalContent && (
                <div className="flex items-center gap-2 text-muted-foreground">
                    <span className="h-2 w-2 animate-bounce rounded-full bg-current opacity-60" style={{ animationDelay: '0ms' }} />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-current opacity-60" style={{ animationDelay: '150ms' }} />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-current opacity-60" style={{ animationDelay: '300ms' }} />
                </div>
            )}

            {/* 来源列表 - 使用传入的 sources 或备用提取 */}
            {(providedSources && providedSources.length > 0) && renderSources(providedSources)}
        </div>
    )
}
