import { useState, useRef } from 'react'
import { Check, Copy, Volume2, Square, Loader2 } from 'lucide-react'

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

export function TTSButton({ content, className, lang }: { content: string; className?: string; lang?: string }) {
    const [isPlaying, setIsPlaying] = useState(false)
    const [isLoading, setIsLoading] = useState(false)
    const audioRef = useRef<HTMLAudioElement | null>(null)

    const PYTHON_SERVICE_URL = 'http://127.0.0.1:18888'

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

    const detectLanguage = (text: string): string => {
        if (/[\u4e00-\u9fa5]/.test(text)) return 'zh'
        if (/[\u3040-\u309f\u30a0-\u30ff]/.test(text)) return 'ja'
        if (/[\uac00-\ud7af]/.test(text)) return 'ko'
        if (/[\u0600-\u06ff]/.test(text)) return 'ar'
        if (/[\u0400-\u04ff]/.test(text)) return 'ru'
        if (/[\u0e00-\u0e7f]/.test(text)) return 'th'
        if (/[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(text)) return 'vi'
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
            const detectedLang = lang || detectLanguage(content)
            const voice = voiceMap[detectedLang] || voiceMap['en']

            const response = await fetch(`${PYTHON_SERVICE_URL}/tts/speak`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: content, voice, rate: '+0%', volume: '+0%' })
            })

            if (!response.ok) throw new Error('TTS 请求失败')

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
