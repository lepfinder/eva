/**
 * Favicon 下载页面组件
 */
import { useState } from 'react'
import {
    ArrowLeft,
    Download,
    Loader2,
    Check,
    AlertCircle,
    Image as ImageIcon,
    Copy
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'

interface DownloadResult {
    success: boolean
    filename?: string
    error?: string
    source: 'google' | 'faviconim'
    imageData?: string
}

interface FaviconDownloadPageProps {
    onBack: () => void
}

export function FaviconDownloadPage({
    onBack
}: FaviconDownloadPageProps): React.ReactElement {
    const [url, setUrl] = useState('')
    const [loading, setLoading] = useState<'google' | 'faviconim' | null>(null)
    const [results, setResults] = useState<DownloadResult[]>([])
    const [copiedFilename, setCopiedFilename] = useState<string | null>(null)

    // 下载 Favicon
    const handleDownload = async (source: 'google' | 'faviconim') => {
        if (!url.trim()) return

        setLoading(source)
        try {
            const result = await window.api.downloadFavicon(url.trim(), source)

            let imageData: string | undefined
            if (result.success && result.filename) {
                // 获取图标的 base64 数据用于预览
                imageData = await window.api.getNavIconData(result.filename) || undefined
            }

            setResults((prev) => [
                { ...result, source, imageData },
                ...prev.slice(0, 9) // 保留最近 10 个结果
            ])
        } catch (err) {
            setResults((prev) => [
                { success: false, error: '下载失败', source },
                ...prev.slice(0, 9)
            ])
        } finally {
            setLoading(null)
        }
    }

    // 复制文件名
    const copyFilename = async (filename: string) => {
        try {
            await navigator.clipboard.writeText(filename)
            setCopiedFilename(filename)
            setTimeout(() => setCopiedFilename(null), 2000)
        } catch (err) {
            console.error('复制失败:', err)
        }
    }

    return (
        <div className="h-full flex flex-col">
            {/* 顶部栏 */}
            <div className="shrink-0 pb-6 flex items-center gap-4">
                <Button variant="ghost" size="icon" onClick={onBack}>
                    <ArrowLeft className="h-5 w-5" />
                </Button>
                <h2 className="text-xl font-semibold">Favicon 下载器</h2>
            </div>

            {/* 下载表单 */}
            <Card className="shrink-0 mb-6">
                <CardContent className="pt-6">
                    <div className="flex flex-col items-center gap-6">
                        <div className="w-full max-w-2xl">
                            <Input
                                placeholder="请输入网站地址 (例如: https://example.com)"
                                value={url}
                                onChange={(e) => setUrl(e.target.value)}
                                className="text-center h-12 text-base"
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && url.trim()) {
                                        handleDownload('google')
                                    }
                                }}
                            />
                        </div>

                        <div className="flex gap-4">
                            <Button
                                size="lg"
                                onClick={() => handleDownload('google')}
                                disabled={!url.trim() || loading !== null}
                                className="min-w-[200px]"
                            >
                                {loading === 'google' ? (
                                    <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        下载中...
                                    </>
                                ) : (
                                    <>
                                        <Download className="mr-2 h-4 w-4" />
                                        通过 Google Favicon 获取
                                    </>
                                )}
                            </Button>

                            <Button
                                size="lg"
                                variant="secondary"
                                onClick={() => handleDownload('faviconim')}
                                disabled={!url.trim() || loading !== null}
                                className="min-w-[200px] bg-emerald-500 hover:bg-emerald-600 text-white"
                            >
                                {loading === 'faviconim' ? (
                                    <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        下载中...
                                    </>
                                ) : (
                                    <>
                                        <Download className="mr-2 h-4 w-4" />
                                        通过 favicon.im 获取
                                    </>
                                )}
                            </Button>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* 下载结果 */}
            {results.length > 0 && (
                <div className="flex-1 overflow-auto">
                    <h3 className="text-sm font-medium mb-3 text-muted-foreground">
                        下载记录
                    </h3>
                    <div className="space-y-3">
                        {results.map((result, index) => (
                            <Card key={index} className={result.success ? '' : 'border-destructive/50'}>
                                <CardContent className="p-4">
                                    <div className="flex items-center gap-4">
                                        {/* 图标/状态 */}
                                        <div className="h-12 w-12 rounded-lg bg-muted flex items-center justify-center overflow-hidden shrink-0">
                                            {result.success && result.imageData ? (
                                                <img
                                                    src={result.imageData}
                                                    alt="favicon"
                                                    className="max-w-full max-h-full object-contain"
                                                />
                                            ) : result.success ? (
                                                <Check className="h-6 w-6 text-emerald-500" />
                                            ) : (
                                                <AlertCircle className="h-6 w-6 text-destructive" />
                                            )}
                                        </div>

                                        {/* 信息 */}
                                        <div className="flex-1 min-w-0">
                                            {result.success ? (
                                                <>
                                                    <p className="font-medium truncate">{result.filename}</p>
                                                    <p className="text-xs text-muted-foreground">
                                                        通过 {result.source === 'google' ? 'Google Favicon' : 'favicon.im'} 下载成功
                                                    </p>
                                                </>
                                            ) : (
                                                <>
                                                    <p className="font-medium text-destructive">下载失败</p>
                                                    <p className="text-xs text-muted-foreground">{result.error}</p>
                                                </>
                                            )}
                                        </div>

                                        {/* 操作 */}
                                        {result.success && result.filename && (
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => copyFilename(result.filename!)}
                                            >
                                                {copiedFilename === result.filename ? (
                                                    <>
                                                        <Check className="mr-1 h-3 w-3" />
                                                        已复制
                                                    </>
                                                ) : (
                                                    <>
                                                        <Copy className="mr-1 h-3 w-3" />
                                                        复制文件名
                                                    </>
                                                )}
                                            </Button>
                                        )}
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                </div>
            )}

            {/* 空状态 */}
            {results.length === 0 && (
                <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
                    <ImageIcon className="h-16 w-16 mb-4 opacity-30" />
                    <p>输入网站地址后点击下载按钮获取 Favicon</p>
                    <p className="text-sm mt-1">支持通过 Google 和 favicon.im 两种方式获取</p>
                </div>
            )}
        </div>
    )
}
