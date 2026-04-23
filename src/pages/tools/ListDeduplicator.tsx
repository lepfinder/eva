/**
 * 列表去重工具组件
 * 支持按行去重，保留原始顺序或按字母排序
 */
import { useState, useCallback } from 'react'
import {
    Trash2,
    Copy,
    ClipboardPaste,
    Check,
    ArrowRight,
    SortAsc,
    ListOrdered,
    FileText
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

// 示例列表
const SAMPLE_LIST = `apple
banana
orange
apple
grape
banana
mango
apple
grape
kiwi`

export function ListDeduplicator(): React.ReactElement {
    const [input, setInput] = useState('')
    const [output, setOutput] = useState('')
    const [sortOutput, setSortOutput] = useState(false)
    const [caseSensitive, setCaseSensitive] = useState(true)
    const [trimSpaces, setTrimSpaces] = useState(true)
    const [inputCopied, setInputCopied] = useState(false)
    const [outputCopied, setOutputCopied] = useState(false)

    // 去重处理
    const deduplicate = useCallback(() => {
        if (!input.trim()) {
            setOutput('')
            return
        }

        let lines = input.split('\n')

        // 去除空行和修剪空格
        if (trimSpaces) {
            lines = lines.map(line => line.trim()).filter(line => line !== '')
        } else {
            lines = lines.filter(line => line !== '')
        }

        // 去重
        const seen = new Set<string>()
        const uniqueLines: string[] = []

        for (const line of lines) {
            const key = caseSensitive ? line : line.toLowerCase()
            if (!seen.has(key)) {
                seen.add(key)
                uniqueLines.push(line)
            }
        }

        // 排序（可选）
        let result = uniqueLines
        if (sortOutput) {
            result = [...uniqueLines].sort((a, b) => {
                const aLower = a.toLowerCase()
                const bLower = b.toLowerCase()
                return aLower.localeCompare(bLower, 'zh-CN')
            })
        }

        setOutput(result.join('\n'))
    }, [input, sortOutput, caseSensitive, trimSpaces])

    // 统计信息
    const inputLines = input.split('\n').filter(l => trimSpaces ? l.trim() !== '' : l !== '').length
    const outputLines = output.split('\n').filter(l => l !== '').length
    const duplicatesRemoved = inputLines - outputLines

    // 复制到剪贴板
    const copyToClipboard = async (text: string, setCopied: (v: boolean) => void) => {
        try {
            await navigator.clipboard.writeText(text)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
        } catch (err) {
            console.error('复制失败:', err)
        }
    }

    // 从剪贴板粘贴
    const pasteFromClipboard = async () => {
        try {
            const text = await navigator.clipboard.readText()
            setInput(text)
        } catch (err) {
            console.error('粘贴失败:', err)
        }
    }

    // 加载示例
    const loadSample = () => {
        setInput(SAMPLE_LIST)
    }

    // 清空
    const clearAll = () => {
        setInput('')
        setOutput('')
    }

    return (
        <TooltipProvider delayDuration={300}>
            <div className="h-full flex flex-col gap-4">
                {/* 选项区域 */}
                <div className="shrink-0 flex items-center justify-between flex-wrap gap-4">
                    <div className="flex items-center gap-6">
                        <div className="flex items-center gap-3">
                            <Switch
                                id="case-sensitive"
                                checked={caseSensitive}
                                onCheckedChange={setCaseSensitive}
                            />
                            <Label htmlFor="case-sensitive" className="text-sm cursor-pointer">
                                区分大小写
                            </Label>
                        </div>

                        <div className="flex items-center gap-3">
                            <Switch
                                id="trim-spaces"
                                checked={trimSpaces}
                                onCheckedChange={setTrimSpaces}
                            />
                            <Label htmlFor="trim-spaces" className="text-sm cursor-pointer">
                                修剪空格
                            </Label>
                        </div>

                        <div className="flex items-center gap-3">
                            <Switch
                                id="sort-output"
                                checked={sortOutput}
                                onCheckedChange={setSortOutput}
                            />
                            <Label htmlFor="sort-output" className="text-sm cursor-pointer">
                                按字母排序
                            </Label>
                        </div>
                    </div>

                    <Button onClick={deduplicate} disabled={!input.trim()}>
                        <ArrowRight className="h-4 w-4 mr-2" />
                        去重
                    </Button>
                </div>

                {/* 编辑区域 */}
                <div className="flex-1 min-h-0 grid grid-cols-2 gap-4">
                    {/* 输入区域 */}
                    <div className="flex flex-col border rounded-lg overflow-hidden bg-card">
                        <div className="shrink-0 flex items-center justify-between px-3 py-2 border-b bg-muted/30">
                            <span className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                                <ListOrdered className="h-4 w-4" />
                                输入列表
                            </span>
                            <div className="flex items-center gap-1">
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={loadSample}
                                            className="h-8 w-8"
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
                                            onClick={pasteFromClipboard}
                                            className="h-8 w-8"
                                        >
                                            <ClipboardPaste className="h-4 w-4" />
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>粘贴</TooltipContent>
                                </Tooltip>

                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={clearAll}
                                            disabled={!input && !output}
                                            className="h-8 w-8"
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
                                            onClick={() => copyToClipboard(input, setInputCopied)}
                                            disabled={!input}
                                            className="h-8 w-8"
                                        >
                                            {inputCopied ? (
                                                <Check className="h-4 w-4 text-green-500" />
                                            ) : (
                                                <Copy className="h-4 w-4" />
                                            )}
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>{inputCopied ? '已复制' : '复制'}</TooltipContent>
                                </Tooltip>
                            </div>
                        </div>

                        <textarea
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            className="flex-1 p-3 bg-transparent font-mono text-sm resize-none border-0 outline-none focus:ring-0"
                            placeholder="每行一个项目...&#10;&#10;例如：&#10;apple&#10;banana&#10;apple&#10;orange"
                            spellCheck={false}
                        />

                        <div className="shrink-0 px-3 py-1.5 border-t bg-muted/30 text-xs text-muted-foreground">
                            <span>{inputLines} 行</span>
                        </div>
                    </div>

                    {/* 输出区域 */}
                    <div className="flex flex-col border rounded-lg overflow-hidden bg-card">
                        <div className="shrink-0 flex items-center justify-between px-3 py-2 border-b bg-muted/30">
                            <span className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                                {sortOutput ? (
                                    <SortAsc className="h-4 w-4" />
                                ) : (
                                    <ListOrdered className="h-4 w-4" />
                                )}
                                去重结果
                            </span>
                            <div className="flex items-center gap-1">
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => copyToClipboard(output, setOutputCopied)}
                                            disabled={!output}
                                            className="h-8 w-8"
                                        >
                                            {outputCopied ? (
                                                <Check className="h-4 w-4 text-green-500" />
                                            ) : (
                                                <Copy className="h-4 w-4" />
                                            )}
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>{outputCopied ? '已复制' : '复制'}</TooltipContent>
                                </Tooltip>
                            </div>
                        </div>

                        <textarea
                            value={output}
                            readOnly
                            className="flex-1 p-3 bg-transparent font-mono text-sm resize-none border-0 outline-none"
                            placeholder="去重后的结果将显示在这里..."
                            spellCheck={false}
                        />

                        <div className="shrink-0 px-3 py-1.5 border-t bg-muted/30 text-xs text-muted-foreground flex items-center justify-between">
                            <span>{outputLines} 行</span>
                            {duplicatesRemoved > 0 && (
                                <span className="text-green-600 dark:text-green-400">
                                    已移除 {duplicatesRemoved} 个重复项
                                </span>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </TooltipProvider>
    )
}
