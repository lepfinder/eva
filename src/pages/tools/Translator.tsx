/**
 * AI 翻译工具 (多模型对比版)
 * 支持 Hunyuan, Gemma 等模型并行翻译对比
 */
import { useState, useCallback, useEffect } from 'react'
import { ArrowRightLeft, Copy, Check, Loader2, AlertCircle, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/components/ui/select'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { TTSButton } from '@/components/chat/MessageComponents'

const PYTHON_SERVICE_URL = 'http://127.0.0.1:18888'

// 支持的语言
const LANGUAGES = [
    { code: 'zh', name: '中文', flag: '🇨🇳' },
    { code: 'en', name: '英语', flag: '🇺🇸' },
    { code: 'ja', name: '日语', flag: '🇯🇵' },
    { code: 'ko', name: '韩语', flag: '🇰🇷' },
    { code: 'fr', name: '法语', flag: '🇫🇷' },
    { code: 'de', name: '德语', flag: '🇩🇪' },
    { code: 'es', name: '西班牙语', flag: '🇪🇸' },
    { code: 'pt', name: '葡萄牙语', flag: '🇵🇹' },
    { code: 'ru', name: '俄语', flag: '🇷🇺' },
    { code: 'it', name: '意大利语', flag: '🇮🇹' },
    { code: 'ar', name: '阿拉伯语', flag: '🇸🇦' },
    { code: 'th', name: '泰语', flag: '🇹🇭' },
    { code: 'vi', name: '越南语', flag: '🇻🇳' },
]

interface TranslationResult {
    text: string
    loading: boolean
    error: string | null
    modelName: string
}

interface ModelInfo {
    id: string
    name: string
    available: boolean
    full_id: string
}

export function Translator(): React.ReactElement {
    const [sourceText, setSourceText] = useState('')
    const [sourceLang, setSourceLang] = useState('zh')
    const [targetLang, setTargetLang] = useState('en')

    // 多模型状态
    const [models, setModels] = useState<ModelInfo[]>([])
    const [selectedModels, setSelectedModels] = useState<string[]>([])
    const [results, setResults] = useState<Record<string, TranslationResult>>({})
    const [isGlobalTranslating, setIsGlobalTranslating] = useState(false)
    const [copiedId, setCopiedId] = useState<string | null>(null)

    // 加载可用模型
    useEffect(() => {
        fetch(`${PYTHON_SERVICE_URL}/translate/status`)
            .then(res => res.json())
            .then(data => {
                if (data.models) {
                    setModels(data.models)
                    // 默认全选可用模型
                    const availableIds = data.models.filter((m: ModelInfo) => m.available).map((m: ModelInfo) => m.id)
                    setSelectedModels(availableIds.length > 0 ? availableIds : ['hunyuan'])
                }
            })
            .catch(err => console.error("Failed to fetch translation models", err))
    }, [])

    // 执行翻译
    const handleTranslate = useCallback(async () => {
        if (!sourceText.trim() || selectedModels.length === 0) return

        setIsGlobalTranslating(true)

        // 初始化结果状态
        const newResults = { ...results }
        selectedModels.forEach(modelId => {
            const modelInfo = models.find(m => m.id === modelId)
            newResults[modelId] = {
                text: '',
                loading: true,
                error: null,
                modelName: modelInfo?.name || modelId
            }
        })
        setResults(newResults)

        // 并行请求
        const promises = selectedModels.map(async (modelId) => {
            try {
                const response = await fetch(`${PYTHON_SERVICE_URL}/translate`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        text: sourceText,
                        source_lang: sourceLang,
                        target_lang: targetLang,
                        model: modelId
                    })
                })

                if (!response.ok) {
                    const errorDate = await response.json().catch(() => ({}))
                    throw new Error(errorDate.detail || `HTTP Error ${response.status}`)
                }

                const data = await response.json()

                setResults(prev => ({
                    ...prev,
                    [modelId]: {
                        ...prev[modelId],
                        text: data.translated_text,
                        loading: false,
                        error: null
                    }
                }))
            } catch (err: any) {
                setResults(prev => ({
                    ...prev,
                    [modelId]: {
                        ...prev[modelId],
                        text: '',
                        loading: false,
                        error: err.message
                    }
                }))
            }
        })

        await Promise.all(promises)
        setIsGlobalTranslating(false)
    }, [sourceText, sourceLang, targetLang, selectedModels, models, results])

    // Copy handler
    const handleCopy = (text: string, id: string) => {
        if (!text) return
        navigator.clipboard.writeText(text)
        setCopiedId(id)
        setTimeout(() => setCopiedId(null), 2000)
    }

    // Toggle model selection
    const toggleModel = (id: string, checked: boolean) => {
        if (checked) {
            setSelectedModels(prev => [...prev, id])
        } else {
            setSelectedModels(prev => prev.filter(m => m !== id))
        }
    }

    const getLanguageInfo = (code: string) => LANGUAGES.find(l => l.code === code) || LANGUAGES[0]

    return (
        <div className="h-full flex flex-col gap-4 overflow-hidden">
            {/* 顶部控制区 */}
            <Card className="shrink-0 bg-muted/20">
                <CardContent className="p-4 space-y-4">
                    {/* 语言选择与操作栏 */}
                    <div className="flex items-center justify-between gap-4 flex-wrap">
                        <div className="flex items-center gap-2">
                            <Select value={sourceLang} onValueChange={setSourceLang}>
                                <SelectTrigger className="w-[140px] bg-background">
                                    <SelectValue>
                                        <span className="flex items-center gap-2">
                                            <span>{getLanguageInfo(sourceLang).flag}</span>
                                            <span>{getLanguageInfo(sourceLang).name}</span>
                                        </span>
                                    </SelectValue>
                                </SelectTrigger>
                                <SelectContent>
                                    {LANGUAGES.map(lang => (
                                        <SelectItem key={lang.code} value={lang.code}>
                                            <span className="flex items-center gap-2">
                                                <span>{lang.flag}</span>
                                                <span>{lang.name}</span>
                                            </span>
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>

                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => {
                                    setSourceLang(targetLang)
                                    setTargetLang(sourceLang)
                                }}
                            >
                                <ArrowRightLeft className="h-4 w-4" />
                            </Button>

                            <Select value={targetLang} onValueChange={setTargetLang}>
                                <SelectTrigger className="w-[140px] bg-background">
                                    <SelectValue>
                                        <span className="flex items-center gap-2">
                                            <span>{getLanguageInfo(targetLang).flag}</span>
                                            <span>{getLanguageInfo(targetLang).name}</span>
                                        </span>
                                    </SelectValue>
                                </SelectTrigger>
                                <SelectContent>
                                    {LANGUAGES.map(lang => (
                                        <SelectItem key={lang.code} value={lang.code}>
                                            <span className="flex items-center gap-2">
                                                <span>{lang.flag}</span>
                                                <span>{lang.name}</span>
                                            </span>
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="flex items-center gap-4">
                            {/* 模型选择 */}
                            <div className="flex items-center gap-4 px-4 py-2 bg-background rounded-md border text-sm">
                                <span className="font-medium text-muted-foreground mr-2">对比模型:</span>
                                {models.length === 0 ? (
                                    <span className="text-muted-foreground text-xs">加载模型列表中...</span>
                                ) : (
                                    models.map(model => (
                                        <div key={model.id} className="flex items-center space-x-2">
                                            <Checkbox
                                                id={`model-${model.id}`}
                                                checked={selectedModels.includes(model.id)}
                                                onCheckedChange={(c) => toggleModel(model.id, c === true)}
                                                disabled={!model.available}
                                            />
                                            <Label
                                                htmlFor={`model-${model.id}`}
                                                className={`cursor-pointer ${!model.available ? 'text-muted-foreground line-through' : ''}`}
                                            >
                                                {model.name}
                                                {!model.available && " (未安装)"}
                                            </Label>
                                        </div>
                                    ))
                                )}
                            </div>

                            <Button
                                onClick={handleTranslate}
                                disabled={isGlobalTranslating || !sourceText.trim() || selectedModels.length === 0}
                                className="min-w-[100px]"
                            >
                                {isGlobalTranslating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                                翻译
                            </Button>
                        </div>
                    </div>

                    <Textarea
                        placeholder="在此输入要翻译的文本..."
                        value={sourceText}
                        onChange={e => setSourceText(e.target.value)}
                        className="min-h-[100px] resize-none text-base bg-background"
                    />
                </CardContent>
            </Card>

            {/* 翻译结果流 (Card Stream) */}
            <div className="flex-1 overflow-y-auto">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-4">
                    {selectedModels.map(modelId => {
                        const result = results[modelId]
                        const modelInfo = models.find(m => m.id === modelId)

                        // 如果还没有结果状态，暂时不渲染或渲染初始状态
                        if (!result && !isGlobalTranslating) return null

                        const loading = result?.loading || false
                        const text = result?.text
                        const error = result?.error

                        return (
                            <Card key={modelId} className="flex flex-col shadow-sm border-t-4 border-t-primary/20">
                                <CardHeader className="py-3 px-4 bg-muted/10 border-b flex flex-row items-center justify-between space-y-0">
                                    <div className="flex items-center gap-2">
                                        <Badge variant="outline">{modelInfo?.name || modelId}</Badge>
                                        {loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
                                    </div>
                                </CardHeader>
                                <CardContent className="p-4 flex-1 min-h-[150px] flex flex-col">
                                    {loading ? (
                                        <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-2 opacity-50">
                                            <Loader2 className="h-8 w-8 animate-spin" />
                                            <p className="text-xs">正在调用本地模型生成...</p>
                                        </div>
                                    ) : error ? (
                                        <div className="h-full flex flex-col items-center justify-center text-destructive gap-2">
                                            <AlertCircle className="h-6 w-6" />
                                            <p className="text-sm text-center">{error}</p>
                                        </div>
                                    ) : text ? (
                                        <>
                                            <div className="whitespace-pre-wrap text-base font-serif leading-relaxed flex-1">
                                                {text}
                                            </div>
                                            {/* TTS and Copy buttons */}
                                            <div className="flex items-center gap-2 mt-4 pt-3 border-t border-muted">
                                                <TTSButton
                                                    content={text}
                                                    lang={targetLang}
                                                    className="h-8 w-8 p-2 hover:bg-muted"
                                                />
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="h-8 px-2 hover:bg-muted"
                                                    onClick={() => handleCopy(text, modelId)}
                                                >
                                                    {copiedId === modelId ? (
                                                        <Check className="h-4 w-4 text-green-500" />
                                                    ) : (
                                                        <Copy className="h-4 w-4" />
                                                    )}
                                                </Button>
                                            </div>
                                        </>
                                    ) : (
                                        <div className="h-full flex items-center justify-center text-muted-foreground/30 text-sm">
                                            等待翻译...
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        )
                    })}

                    {selectedModels.length === 0 && (
                        <div className="col-span-full h-40 flex items-center justify-center text-muted-foreground">
                            请勾选上方模型进行翻译
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
