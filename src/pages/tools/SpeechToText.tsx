/**
 * 语音转文本工具
 * 支持上传音频文件，使用 mlx_whisper 进行转写
 */
import { useState, useCallback, useRef } from 'react'
import { Mic, Upload, Copy, Check, Loader2, AlertCircle, Trash2, FileAudio, Clock, Languages, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/components/ui/select'
import { Progress } from '@/components/ui/progress'

const PYTHON_SERVICE_URL = 'http://127.0.0.1:18888'

// 可用的模型
const AVAILABLE_MODELS = [
    {
        id: 'mlx-community/whisper-large-v3-turbo',
        name: 'Whisper Large V3 Turbo',
        description: '最新最快的模型',
        size: '~1.5GB'
    },
    {
        id: 'mlx-community/whisper-large-v3-mlx',
        name: 'Whisper Large V3',
        description: '高精度模型',
        size: '~3GB'
    },
    {
        id: 'mlx-community/whisper-medium-mlx',
        name: 'Whisper Medium',
        description: '平衡速度与精度',
        size: '~1.5GB'
    },
    {
        id: 'mlx-community/whisper-small-mlx',
        name: 'Whisper Small',
        description: '轻量级模型',
        size: '~500MB'
    }
]

// 支持的语言
const LANGUAGES = [
    { code: 'auto', name: '自动检测', flag: '🌐' },
    { code: 'zh', name: '中文', flag: '🇨🇳' },
    { code: 'en', name: '英文', flag: '🇺🇸' },
    { code: 'ja', name: '日文', flag: '🇯🇵' },
    { code: 'ko', name: '韩文', flag: '🇰🇷' },
    { code: 'fr', name: '法文', flag: '🇫🇷' },
    { code: 'de', name: '德文', flag: '🇩🇪' },
    { code: 'es', name: '西班牙文', flag: '🇪🇸' }
]

interface TranscribeResult {
    text: string
    language?: string
    duration?: number
    processingTime: number
}

export function SpeechToText(): React.ReactElement {
    const [selectedFile, setSelectedFile] = useState<File | null>(null)
    const [selectedModel, setSelectedModel] = useState(AVAILABLE_MODELS[0].id)
    const [selectedLanguage, setSelectedLanguage] = useState('auto')
    const [isTranscribing, setIsTranscribing] = useState(false)
    const [result, setResult] = useState<TranscribeResult | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [copied, setCopied] = useState(false)
    const [progress, setProgress] = useState(0)

    const fileInputRef = useRef<HTMLInputElement>(null)

    // 处理文件选择
    const handleFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0]
        if (file) {
            // 验证文件类型
            const allowedTypes = ['audio/mpeg', 'audio/wav', 'audio/mp4', 'audio/m4a', 'audio/flac', 'audio/ogg', 'audio/webm', 'video/mp4']
            const allowedExtensions = ['.mp3', '.wav', '.m4a', '.flac', '.ogg', '.webm', '.mp4']

            const fileExt = file.name.substring(file.name.lastIndexOf('.')).toLowerCase()

            if (!allowedTypes.includes(file.type) && !allowedExtensions.includes(fileExt)) {
                setError(`不支持的文件格式: ${file.type || fileExt}。支持: MP3, WAV, M4A, FLAC, OGG, WebM, MP4`)
                return
            }

            setSelectedFile(file)
            setError(null)
            setResult(null)
        }
    }, [])

    // 处理拖放
    const handleDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault()
        const file = event.dataTransfer.files?.[0]
        if (file) {
            const fileExt = file.name.substring(file.name.lastIndexOf('.')).toLowerCase()
            const allowedExtensions = ['.mp3', '.wav', '.m4a', '.flac', '.ogg', '.webm', '.mp4']

            if (allowedExtensions.includes(fileExt)) {
                setSelectedFile(file)
                setError(null)
                setResult(null)
            } else {
                setError(`不支持的文件格式: ${fileExt}`)
            }
        }
    }, [])

    const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault()
    }, [])

    // 开始转写
    const handleTranscribe = useCallback(async () => {
        if (!selectedFile) return

        setIsTranscribing(true)
        setError(null)
        setResult(null)
        setProgress(10)

        try {
            const formData = new FormData()
            formData.append('file', selectedFile)
            formData.append('model', selectedModel)
            if (selectedLanguage && selectedLanguage !== 'auto') {
                formData.append('language', selectedLanguage)
            }

            setProgress(30)

            const response = await fetch(`${PYTHON_SERVICE_URL}/transcribe/audio`, {
                method: 'POST',
                body: formData
            })

            setProgress(90)

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}))
                throw new Error(errorData.detail || `转写失败: ${response.status}`)
            }

            const data = await response.json()

            setResult({
                text: data.text,
                language: data.language,
                duration: data.duration,
                processingTime: data.processing_time
            })

            setProgress(100)
        } catch (err) {
            setError(err instanceof Error ? err.message : '转写出错，请检查 AI Engine 是否运行')
        } finally {
            setIsTranscribing(false)
            setTimeout(() => setProgress(0), 500)
        }
    }, [selectedFile, selectedModel, selectedLanguage])

    // 复制结果
    const handleCopy = useCallback(async () => {
        if (!result?.text) return
        await navigator.clipboard.writeText(result.text)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }, [result])

    // 下载为文本文件
    const handleDownload = useCallback(() => {
        if (!result?.text) return
        const blob = new Blob([result.text], { type: 'text/plain;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `transcription_${new Date().toISOString().slice(0, 10)}.txt`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
    }, [result])

    // 清除
    const handleClear = useCallback(() => {
        setSelectedFile(null)
        setResult(null)
        setError(null)
        if (fileInputRef.current) {
            fileInputRef.current.value = ''
        }
    }, [])

    // 格式化文件大小
    const formatFileSize = (bytes: number) => {
        if (bytes >= 1024 * 1024) {
            return `${(bytes / 1024 / 1024).toFixed(1)} MB`
        }
        return `${(bytes / 1024).toFixed(1)} KB`
    }

    return (
        <div className="h-full flex flex-col gap-4">
            {/* 设置区域 */}
            <div className="shrink-0 flex items-center gap-4 flex-wrap">
                {/* 模型选择 */}
                <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">模型:</span>
                    <Select value={selectedModel} onValueChange={setSelectedModel}>
                        <SelectTrigger className="w-[280px]">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {AVAILABLE_MODELS.map(model => (
                                <SelectItem key={model.id} value={model.id}>
                                    <div className="flex items-center justify-between gap-4">
                                        <span>{model.name}</span>
                                        <span className="text-xs text-muted-foreground">{model.size}</span>
                                    </div>
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                {/* 语言选择 */}
                <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">语言:</span>
                    <Select value={selectedLanguage} onValueChange={setSelectedLanguage}>
                        <SelectTrigger className="w-[160px]">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {LANGUAGES.map(lang => (
                                <SelectItem key={lang.code} value={lang.code}>
                                    <span>{lang.flag} {lang.name}</span>
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            </div>

            {/* 主内容区 */}
            <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-4 min-h-0">
                {/* 左侧：文件上传 */}
                <Card className="flex flex-col">
                    <CardHeader className="shrink-0 pb-3">
                        <CardTitle className="text-base flex items-center gap-2">
                            <FileAudio className="h-4 w-4" />
                            音频文件
                        </CardTitle>
                        <CardDescription>
                            支持 MP3, WAV, M4A, FLAC, OGG, WebM, MP4 格式
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="flex-1 flex flex-col gap-4">
                        {/* 拖放区域 */}
                        <div
                            className={`flex-1 border-2 border-dashed rounded-lg flex flex-col items-center justify-center gap-4 transition-colors cursor-pointer hover:border-primary/50 hover:bg-muted/30 ${selectedFile ? 'border-primary bg-primary/5' : 'border-muted-foreground/25'
                                }`}
                            onClick={() => fileInputRef.current?.click()}
                            onDrop={handleDrop}
                            onDragOver={handleDragOver}
                        >
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="audio/*,video/mp4"
                                onChange={handleFileSelect}
                                className="hidden"
                            />

                            {selectedFile ? (
                                <>
                                    <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
                                        <FileAudio className="h-8 w-8 text-primary" />
                                    </div>
                                    <div className="text-center">
                                        <p className="font-medium">{selectedFile.name}</p>
                                        <p className="text-sm text-muted-foreground">
                                            {formatFileSize(selectedFile.size)}
                                        </p>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center">
                                        <Upload className="h-8 w-8 text-muted-foreground" />
                                    </div>
                                    <div className="text-center">
                                        <p className="font-medium">点击或拖放音频文件</p>
                                        <p className="text-sm text-muted-foreground">
                                            支持主流音频格式
                                        </p>
                                    </div>
                                </>
                            )}
                        </div>

                        {/* 进度条 */}
                        {isTranscribing && (
                            <div className="space-y-2">
                                <div className="flex items-center justify-between text-sm">
                                    <span className="text-muted-foreground">正在转写...</span>
                                    <span className="text-muted-foreground">{progress}%</span>
                                </div>
                                <Progress value={progress} className="h-2" />
                            </div>
                        )}

                        {/* 操作按钮 */}
                        <div className="flex gap-2">
                            <Button
                                onClick={handleTranscribe}
                                disabled={!selectedFile || isTranscribing}
                                className="flex-1"
                            >
                                {isTranscribing ? (
                                    <>
                                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                        转写中...
                                    </>
                                ) : (
                                    <>
                                        <Mic className="h-4 w-4 mr-2" />
                                        开始转写
                                    </>
                                )}
                            </Button>
                            <Button
                                variant="outline"
                                onClick={handleClear}
                                disabled={isTranscribing}
                            >
                                <Trash2 className="h-4 w-4" />
                            </Button>
                        </div>

                        {/* 错误提示 */}
                        {error && (
                            <div className="flex items-start gap-2 p-3 bg-destructive/10 text-destructive rounded-lg text-sm">
                                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                                <span>{error}</span>
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* 右侧：转写结果 */}
                <Card className="flex flex-col">
                    <CardHeader className="shrink-0 pb-3">
                        <div className="flex items-center justify-between">
                            <CardTitle className="text-base flex items-center gap-2">
                                <Languages className="h-4 w-4" />
                                转写结果
                            </CardTitle>
                            {result && (
                                <div className="flex items-center gap-2">
                                    {result.language && (
                                        <Badge variant="secondary" className="text-xs">
                                            {LANGUAGES.find(l => l.code === result.language)?.name || result.language}
                                        </Badge>
                                    )}
                                    <Badge variant="outline" className="text-xs">
                                        <Clock className="h-3 w-3 mr-1" />
                                        {result.processingTime}s
                                    </Badge>
                                </div>
                            )}
                        </div>
                    </CardHeader>
                    <CardContent className="flex-1 flex flex-col gap-4">
                        <Textarea
                            value={result?.text || ''}
                            readOnly
                            placeholder="转写结果将显示在这里..."
                            className="flex-1 resize-none font-mono text-sm"
                        />

                        {/* 操作按钮 */}
                        <div className="flex gap-2">
                            <Button
                                variant="outline"
                                onClick={handleCopy}
                                disabled={!result?.text}
                                className="flex-1"
                            >
                                {copied ? (
                                    <>
                                        <Check className="h-4 w-4 mr-2" />
                                        已复制
                                    </>
                                ) : (
                                    <>
                                        <Copy className="h-4 w-4 mr-2" />
                                        复制文本
                                    </>
                                )}
                            </Button>
                            <Button
                                variant="outline"
                                onClick={handleDownload}
                                disabled={!result?.text}
                            >
                                <Download className="h-4 w-4" />
                            </Button>
                        </div>

                        {/* 字数统计 */}
                        {result?.text && (
                            <div className="text-xs text-muted-foreground text-right">
                                共 {result.text.length} 字符
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
