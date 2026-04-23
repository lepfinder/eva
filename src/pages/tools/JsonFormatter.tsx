/**
 * JSON 格式化工具组件
 * 支持单列/双列模式和语法高亮
 */
import { useState, useRef, useEffect } from 'react'
import { Highlight, PrismTheme } from 'prism-react-renderer'
import {
    FileCode,
    Archive,
    FileText,
    Trash2,
    Copy,
    ClipboardPaste,
    Check,
    AlertCircle,
    Columns,
    Square
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip'

// 示例 JSON
const SAMPLE_JSON = `{
  "name": "EVA",
  "version": "1.0.0",
  "description": "开发者工具箱",
  "features": ["JSON格式化", "更多工具即将推出"],
  "config": {
    "theme": "dark",
    "language": "zh-CN"
  }
}`

// 参考图二风格：白底 + 高对比语法色
const JSON_VIEWER_THEME: PrismTheme = {
    plain: {
        color: '#111827',
        backgroundColor: '#ffffff'
    },
    styles: [
        {
            types: ['property'],
            style: { color: '#1d4ed8', fontWeight: '600' }
        },
        {
            types: ['string'],
            style: { color: '#111827' }
        },
        {
            types: ['number'],
            style: { color: '#dc2626', fontWeight: '600' }
        },
        {
            types: ['boolean'],
            style: { color: '#dc2626', fontWeight: '700' }
        },
        {
            types: ['null'],
            style: { color: '#dc2626', fontStyle: 'italic' }
        },
        {
            types: ['punctuation'],
            style: { color: '#6b7280' }
        },
        {
            types: ['operator'],
            style: { color: '#6b7280' }
        }
    ]
}

interface EditorPanelProps {
    value: string
    onChange: (value: string) => void
    error: string | null
    onFormat: () => void
    onCompress: () => void
    onSample: () => void
    onClear: () => void
    onCopy: () => void
    onPaste: () => void
    copied: boolean
    lineCount: number
    charCount: number
}

function EditorPanel({
    value,
    onChange,
    error,
    onFormat,
    onCompress,
    onSample,
    onClear,
    onCopy,
    onPaste,
    copied,
    lineCount,
    charCount
}: EditorPanelProps) {
    const textareaRef = useRef<HTMLTextAreaElement>(null)
    const highlightRef = useRef<HTMLPreElement>(null)

    // 同步滚动
    const handleScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
        if (highlightRef.current) {
            highlightRef.current.scrollTop = e.currentTarget.scrollTop
        }
    }

    return (
        <div className="h-full flex flex-col border rounded-lg overflow-hidden bg-white border-zinc-200">
            {/* 工具栏 */}
            <div className="shrink-0 flex items-center justify-between px-3 py-2 border-b border-blue-600 bg-blue-500 text-white">
                {/* 左侧：样例、清空、复制、粘贴 */}
                <div className="flex items-center gap-1">
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={onSample}
                                className="h-8 w-8 text-white/90 hover:text-white hover:bg-white/15"
                            >
                                <FileText className="h-4 w-4" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>加载示例</TooltipContent>
                    </Tooltip>

                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={onClear}
                                disabled={!value}
                                className="h-8 w-8 text-white/90 hover:text-white hover:bg-white/15"
                            >
                                <Trash2 className="h-4 w-4" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>清空</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                disabled={!value}
                                onClick={onCopy}
                                className="h-8 w-8 text-white/90 hover:text-white hover:bg-white/15"
                            >
                                {copied ? <Check className="h-4 w-4 text-green-200" /> : <Copy className="h-4 w-4" />}
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>{copied ? '已复制' : '复制'}</TooltipContent>
                    </Tooltip>

                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={onPaste}
                                className="h-8 w-8 text-white/90 hover:text-white hover:bg-white/15"
                            >
                                <ClipboardPaste className="h-4 w-4" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>粘贴</TooltipContent>
                    </Tooltip>
                </div>

                {/* 右侧：格式化、压缩 */}
                <div className="flex items-center gap-1">
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={onFormat}
                                disabled={!value.trim()}
                                className="h-8 w-8 text-white/90 hover:text-white hover:bg-white/15"
                            >
                                <FileCode className="h-4 w-4" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>格式化</TooltipContent>
                    </Tooltip>

                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={onCompress}
                                disabled={!value.trim()}
                                className="h-8 w-8 text-white/90 hover:text-white hover:bg-white/15"
                            >
                                <Archive className="h-4 w-4" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>压缩</TooltipContent>
                    </Tooltip>
                </div>
            </div>

            {/* 编辑区域 */}
            <div className="flex-1 min-h-0 relative overflow-hidden bg-white">
                {/* 高亮层 */}
                <Highlight
                    theme={JSON_VIEWER_THEME}
                    code={value || ' '}
                    language="json"
                >
                    {({ style, tokens, getLineProps, getTokenProps }) => (
                        <pre
                            ref={highlightRef}
                            className="absolute inset-0 p-3 m-0 overflow-auto pointer-events-none font-mono text-[12px] leading-relaxed"
                            style={{
                                ...style,
                                background: 'transparent',
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-all'
                            }}
                        >
                            {tokens.map((line, i) => (
                                <div key={i} {...getLineProps({ line })}>
                                    {line.map((token, key) => (
                                        <span key={key} {...getTokenProps({ token })} />
                                    ))}
                                </div>
                            ))}
                        </pre>
                    )}
                </Highlight>

                {/* 输入层 */}
                <textarea
                    ref={textareaRef}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    onScroll={handleScroll}
                    className="absolute inset-0 w-full h-full p-3 m-0 bg-transparent text-transparent caret-zinc-900 placeholder:text-zinc-400 font-mono text-[12px] leading-relaxed resize-none border-0 outline-none focus:ring-0"
                    style={{
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-all'
                    }}
                    placeholder="在此输入或粘贴 JSON 数据..."
                    spellCheck={false}
                />
            </div>

            {/* 状态栏 */}
            <div className="shrink-0 flex items-center justify-between px-3 py-1.5 border-t border-zinc-200 bg-zinc-50 text-[12px] text-zinc-500">
                <div className="flex items-center gap-4">
                    {error ? (
                        <span className="flex items-center gap-1 text-destructive">
                            <AlertCircle className="h-3 w-3" />
                            {error}
                        </span>
                    ) : (
                        <>
                            <span>行: {lineCount}</span>
                            <span>字符: {charCount}</span>
                        </>
                    )}
                </div>
                <div>
                    <span>JSON</span>
                </div>
            </div>
        </div>
    )
}

export function JsonFormatter(): React.ReactElement {
    // 从 localStorage 加载缓存
    const loadCache = () => {
        try {
            const cached = localStorage.getItem('json-formatter-cache')
            if (cached) {
                return JSON.parse(cached)
            }
        } catch {
            // ignore
        }
        return { left: '', right: '', dualColumn: true }
    }

    const cachedData = loadCache()
    const [dualColumn, setDualColumn] = useState(cachedData.dualColumn ?? true)

    // 左侧/单列状态
    const [leftContent, setLeftContent] = useState(cachedData.left || '')
    const [leftError, setLeftError] = useState<string | null>(null)
    const [leftCopied, setLeftCopied] = useState(false)

    // 右侧状态
    const [rightContent, setRightContent] = useState(cachedData.right || '')
    const [rightError, setRightError] = useState<string | null>(null)
    const [rightCopied, setRightCopied] = useState(false)

    // 保存到缓存
    useEffect(() => {
        const data = { left: leftContent, right: rightContent, dualColumn }
        localStorage.setItem('json-formatter-cache', JSON.stringify(data))
    }, [leftContent, rightContent, dualColumn])

    // 计算统计信息
    const getStats = (text: string) => ({
        lineCount: text ? text.split('\n').length : 1,
        charCount: text.length
    })

    // 创建面板操作函数
    const createPanelActions = (
        content: string,
        setContent: (v: string) => void,
        setError: (e: string | null) => void,
        setCopied: (v: boolean) => void
    ) => ({
        onFormat: () => {
            if (!content.trim()) return
            try {
                const parsed = JSON.parse(content)
                setContent(JSON.stringify(parsed, null, 2))
                setError(null)
            } catch (err) {
                setError(err instanceof Error ? err.message : '无效的 JSON')
            }
        },
        onCompress: () => {
            if (!content.trim()) return
            try {
                const parsed = JSON.parse(content)
                setContent(JSON.stringify(parsed))
                setError(null)
            } catch (err) {
                setError(err instanceof Error ? err.message : '无效的 JSON')
            }
        },
        onSample: () => {
            setContent(SAMPLE_JSON)
            setError(null)
        },
        onClear: () => {
            setContent('')
            setError(null)
        },
        onCopy: async () => {
            if (!content) return
            try {
                await navigator.clipboard.writeText(content)
                setCopied(true)
                setTimeout(() => setCopied(false), 2000)
            } catch (err) {
                console.error('复制失败:', err)
            }
        },
        onPaste: async () => {
            try {
                const text = await navigator.clipboard.readText()
                setContent(text)
                setError(null)
            } catch (err) {
                console.error('粘贴失败:', err)
            }
        }
    })

    const leftActions = createPanelActions(leftContent, setLeftContent, setLeftError, setLeftCopied)
    const rightActions = createPanelActions(rightContent, setRightContent, setRightError, setRightCopied)
    const leftStats = getStats(leftContent)
    const rightStats = getStats(rightContent)

    return (
        <TooltipProvider delayDuration={300}>
            <div className="h-full flex flex-col gap-2">
                {/* 顶部切换按钮 */}
                <div className="shrink-0 flex items-center justify-end">
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant={dualColumn ? 'secondary' : 'ghost'}
                                size="sm"
                                onClick={() => setDualColumn(!dualColumn)}
                                className="h-8"
                            >
                                {dualColumn ? (
                                    <>
                                        <Square className="h-4 w-4 mr-2" />
                                        单列
                                    </>
                                ) : (
                                    <>
                                        <Columns className="h-4 w-4 mr-2" />
                                        双列对比
                                    </>
                                )}
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>切换单列/双列模式</TooltipContent>
                    </Tooltip>
                </div>

                {/* 编辑区域 */}
                <div className={`flex-1 min-h-0 ${dualColumn ? 'grid grid-cols-2 gap-4' : ''}`}>
                    <EditorPanel
                        value={leftContent}
                        onChange={(v) => {
                            setLeftContent(v)
                            if (leftError) setLeftError(null)
                        }}
                        error={leftError}
                        {...leftActions}
                        copied={leftCopied}
                        lineCount={leftStats.lineCount}
                        charCount={leftStats.charCount}
                    />

                    {dualColumn && (
                        <EditorPanel
                            value={rightContent}
                            onChange={(v) => {
                                setRightContent(v)
                                if (rightError) setRightError(null)
                            }}
                            error={rightError}
                            {...rightActions}
                            copied={rightCopied}
                            lineCount={rightStats.lineCount}
                            charCount={rightStats.charCount}
                        />
                    )}
                </div>
            </div>
        </TooltipProvider>
    )
}
