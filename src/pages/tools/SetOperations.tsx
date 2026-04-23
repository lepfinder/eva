/**
 * 集合运算工具组件
 * 支持计算两个集合的交集、差集
 */
import { useState, useCallback } from 'react'
import {
    Trash2,
    Copy,
    Check,
    Calculator,
    FileText,
    Wand2
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip'

// 示例数据
const SAMPLE_SET_A = `apple
banana
orange
grape
mango
kiwi
watermelon`

const SAMPLE_SET_B = `banana
grape
pineapple
coconut
mango
papaya`

interface ResultCardProps {
    title: string
    subtitle: string
    items: string[]
    copied: boolean
    onCopy: () => void
}

function ResultCard({ title, subtitle, items, copied, onCopy }: ResultCardProps) {
    return (
        <div className="flex flex-col border rounded-lg overflow-hidden bg-card">
            <div className="shrink-0 flex items-center justify-between px-3 py-2 border-b bg-muted/30">
                <div>
                    <span className="text-sm font-semibold">{title}</span>
                    <span className="text-xs text-muted-foreground ml-2">{subtitle}</span>
                </div>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={onCopy}
                            disabled={items.length === 0}
                            className="h-7 w-7"
                        >
                            {copied ? (
                                <Check className="h-3.5 w-3.5 text-green-500" />
                            ) : (
                                <Copy className="h-3.5 w-3.5" />
                            )}
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>{copied ? '已复制' : '复制'}</TooltipContent>
                </Tooltip>
            </div>
            <div className="flex-1 p-3 min-h-[100px] max-h-[200px] overflow-auto">
                {items.length > 0 ? (
                    <pre className="text-sm font-mono text-primary whitespace-pre-wrap">
                        {items.join('\n')}
                    </pre>
                ) : (
                    <span className="text-sm text-muted-foreground">无元素</span>
                )}
            </div>
        </div>
    )
}

export function SetOperations(): React.ReactElement {
    const [setA, setSetA] = useState('')
    const [setB, setSetB] = useState('')
    const [results, setResults] = useState<{
        aMinusB: string[]
        intersection: string[]
        bMinusA: string[]
    }>({ aMinusB: [], intersection: [], bMinusA: [] })

    const [copiedStates, setCopiedStates] = useState({
        aMinusB: false,
        intersection: false,
        bMinusA: false
    })

    // 解析集合
    const parseSet = useCallback((text: string): Set<string> => {
        const lines = text.split('\n')
            .map(line => line.trim())
            .filter(line => line !== '')
        return new Set(lines)
    }, [])

    // 计算集合运算
    const calculate = useCallback(() => {
        const a = parseSet(setA)
        const b = parseSet(setB)

        // A - B: 在 A 中但不在 B 中
        const aMinusB = [...a].filter(x => !b.has(x))

        // A ∩ B: 同时在 A 和 B 中
        const intersection = [...a].filter(x => b.has(x))

        // B - A: 在 B 中但不在 A 中
        const bMinusA = [...b].filter(x => !a.has(x))

        setResults({ aMinusB, intersection, bMinusA })
    }, [setA, setB, parseSet])

    // 复制到剪贴板
    const copyToClipboard = async (items: string[], key: keyof typeof copiedStates) => {
        if (items.length === 0) return
        try {
            await navigator.clipboard.writeText(items.join('\n'))
            setCopiedStates(prev => ({ ...prev, [key]: true }))
            setTimeout(() => {
                setCopiedStates(prev => ({ ...prev, [key]: false }))
            }, 2000)
        } catch (err) {
            console.error('复制失败:', err)
        }
    }

    // 加载示例
    const loadSample = () => {
        setSetA(SAMPLE_SET_A)
        setSetB(SAMPLE_SET_B)
        setResults({ aMinusB: [], intersection: [], bMinusA: [] })
    }

    // 清空
    const clearAll = () => {
        setSetA('')
        setSetB('')
        setResults({ aMinusB: [], intersection: [], bMinusA: [] })
    }

    // 格式化文本：将逗号/换行分隔的文本转换为一行一个
    const formatText = (text: string) => {
        if (!text.trim()) return ''
        return text.split(/[,\n]/)
            .map(item => item.trim())
            .filter(item => item !== '')
            .join('\n')
    }

    const handleFormatA = () => setSetA(formatText(setA))
    const handleFormatB = () => setSetB(formatText(setB))

    // 统计
    const setACount = parseSet(setA).size
    const setBCount = parseSet(setB).size

    return (
        <TooltipProvider delayDuration={300}>
            <div className="h-full flex flex-col gap-4">
                {/* 输入区域 */}
                <div className="flex-1 min-h-0 grid grid-cols-2 gap-4">
                    {/* 集合 A */}
                    <div className="flex flex-col border rounded-lg overflow-hidden bg-card">
                        <div className="shrink-0 flex items-center justify-between px-3 py-2 border-b bg-muted/30">
                            <div className="flex items-center gap-2">
                                <span className="text-sm font-medium">集合 A</span>
                                <span className="text-xs text-muted-foreground">{setACount} 个元素</span>
                            </div>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={handleFormatA}
                                        disabled={!setA.trim()}
                                        className="h-7 w-7"
                                    >
                                        <Wand2 className="h-3.5 w-3.5" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>格式化 (逗号转行)</TooltipContent>
                            </Tooltip>
                        </div>
                        <textarea
                            value={setA}
                            onChange={(e) => setSetA(e.target.value)}
                            className="flex-1 p-3 bg-transparent font-mono text-sm resize-none border-0 outline-none focus:ring-0"
                            placeholder="每行输入一个元素..."
                            spellCheck={false}
                        />
                    </div>

                    {/* 集合 B */}
                    <div className="flex flex-col border rounded-lg overflow-hidden bg-card">
                        <div className="shrink-0 flex items-center justify-between px-3 py-2 border-b bg-muted/30">
                            <div className="flex items-center gap-2">
                                <span className="text-sm font-medium">集合 B</span>
                                <span className="text-xs text-muted-foreground">{setBCount} 个元素</span>
                            </div>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={handleFormatB}
                                        disabled={!setB.trim()}
                                        className="h-7 w-7"
                                    >
                                        <Wand2 className="h-3.5 w-3.5" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>格式化 (逗号转行)</TooltipContent>
                            </Tooltip>
                        </div>
                        <textarea
                            value={setB}
                            onChange={(e) => setSetB(e.target.value)}
                            className="flex-1 p-3 bg-transparent font-mono text-sm resize-none border-0 outline-none focus:ring-0"
                            placeholder="每行输入一个元素..."
                            spellCheck={false}
                        />
                    </div>
                </div>

                {/* 操作按钮 */}
                <div className="shrink-0 flex items-center justify-center gap-3">
                    <Button onClick={calculate} disabled={!setA.trim() && !setB.trim()}>
                        <Calculator className="h-4 w-4 mr-2" />
                        计算
                    </Button>
                    <Button variant="outline" onClick={loadSample}>
                        <FileText className="h-4 w-4 mr-2" />
                        加载示例
                    </Button>
                    <Button variant="outline" onClick={clearAll}>
                        <Trash2 className="h-4 w-4 mr-2" />
                        清空
                    </Button>
                </div>

                {/* 结果区域 */}
                <div className="shrink-0 grid grid-cols-3 gap-4">
                    <ResultCard
                        title="A - B"
                        subtitle={`仅在 A 中 (${results.aMinusB.length} 项)`}
                        items={results.aMinusB}
                        copied={copiedStates.aMinusB}
                        onCopy={() => copyToClipboard(results.aMinusB, 'aMinusB')}
                    />
                    <ResultCard
                        title="A ∩ B"
                        subtitle={`交集 (${results.intersection.length} 项)`}
                        items={results.intersection}
                        copied={copiedStates.intersection}
                        onCopy={() => copyToClipboard(results.intersection, 'intersection')}
                    />
                    <ResultCard
                        title="B - A"
                        subtitle={`仅在 B 中 (${results.bMinusA.length} 项)`}
                        items={results.bMinusA}
                        copied={copiedStates.bMinusA}
                        onCopy={() => copyToClipboard(results.bMinusA, 'bMinusA')}
                    />
                </div>
            </div>
        </TooltipProvider>
    )
}
