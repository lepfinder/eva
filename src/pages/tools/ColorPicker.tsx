import { useState } from 'react'
import { Copy, RefreshCw, Palette, Hash, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

export function ColorPicker() {
    const [color, setColor] = useState('#6366F1')
    const [inputValue, setInputValue] = useState('#6366F1')
    const [history, setHistory] = useState<string[]>(['#6366F1', '#EC4899', '#10B981', '#F59E0B', '#3B82F6'])
    const [copied, setCopied] = useState(false)

    // 当颜色变化时同步输入框
    const handleColorChange = (newColor: string) => {
        const upperColor = newColor.toUpperCase()
        setColor(upperColor)
        setInputValue(upperColor)
        addToHistory(upperColor)
    }

    // 当手动输入 Hex 时逻辑
    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value.toUpperCase()
        setInputValue(val)
        
        // 验证是否为合法的 Hex 颜色
        if (/^#?([0-9A-F]{3}){1,2}$/i.test(val)) {
            const formatted = val.startsWith('#') ? val : `#${val}`
            if (formatted.length === 4 || formatted.length === 7) {
                setColor(formatted)
                addToHistory(formatted)
            }
        }
    }

    const addToHistory = (newColor: string) => {
        setHistory(prev => {
            if (prev.includes(newColor)) return prev
            return [newColor, ...prev.slice(0, 11)]
        })
    }

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }

    const getRandomColor = () => {
        const letters = '0123456789ABCDEF'
        let color = '#'
        for (let i = 0; i < 6; i++) {
            color += letters[Math.floor(Math.random() * 16)]
        }
        handleColorChange(color)
    }

    return (
        <div className="h-full flex flex-col space-y-6 max-w-4xl mx-auto p-2">
            <Card className="border-none bg-transparent shadow-none">
                <CardContent className="p-0 space-y-8">
                    {/* 主预览区 */}
                    <div className="flex flex-col md:flex-row gap-8 items-center md:items-start">
                        {/* 大色块/选择器 */}
                        <div className="relative group shrink-0">
                            <div 
                                className="w-48 h-48 md:w-64 md:h-64 rounded-3xl shadow-2xl border-4 border-white dark:border-zinc-800 overflow-hidden cursor-pointer"
                                style={{ backgroundColor: color }}
                                onClick={() => document.getElementById('color-input')?.click()}
                            >
                                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/10">
                                    <Palette className="w-12 h-12 text-white drop-shadow-md" />
                                </div>
                            </div>
                            <input 
                                id="color-input"
                                type="color" 
                                value={color} 
                                onChange={(e) => handleColorChange(e.target.value)}
                                className="absolute -bottom-10 opacity-0 w-0 h-0"
                            />
                        </div>

                        {/* 控制与信息区 */}
                        <div className="flex-1 w-full space-y-6">
                            <div className="space-y-4">
                                <label className="text-sm font-medium text-muted-foreground uppercase tracking-wider font-mono">Hex Code</label>
                                <div className="flex gap-2">
                                    <div className="relative flex-1">
                                        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400">
                                            <Hash className="w-4 h-4" />
                                        </div>
                                        <Input 
                                            value={inputValue} 
                                            onChange={handleInputChange}
                                            className="pl-9 h-12 text-lg font-mono bg-white/50 dark:bg-zinc-900/50 border-zinc-200"
                                            placeholder="#000000"
                                        />
                                    </div>
                                    <Button 
                                        variant={copied ? "secondary" : "outline"} 
                                        size="icon" 
                                        className="h-12 w-12 shrink-0 transition-all"
                                        onClick={() => copyToClipboard(color)}
                                    >
                                        {copied ? <Check className="h-5 w-5 text-emerald-500" /> : <Copy className="h-5 w-5" />}
                                    </Button>
                                    <Button 
                                        variant="ghost" 
                                        size="icon" 
                                        className="h-12 w-12 shrink-0 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
                                        onClick={getRandomColor}
                                    >
                                        <RefreshCw className="h-5 w-5" />
                                    </Button>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <Card className="p-3 bg-zinc-50 dark:bg-zinc-900 border-zinc-100 dark:border-zinc-800">
                                    <span className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">RGB 分量</span>
                                    <code className="text-sm font-mono text-zinc-600 dark:text-zinc-300">
                                        {hexToRgb(color)}
                                    </code>
                                </Card>
                                <Card className="p-3 bg-zinc-50 dark:bg-zinc-900 border-zinc-100 dark:border-zinc-800">
                                    <span className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">HSL 空间</span>
                                    <code className="text-sm font-mono text-zinc-600 dark:text-zinc-300">
                                        {hexToHsl(color)}
                                    </code>
                                </Card>
                            </div>
                        </div>
                    </div>

                    {/* 历史记录/调色盘 */}
                    <div className="space-y-4 pt-4">
                        <div className="flex items-center justify-between px-1">
                            <span className="text-sm font-bold text-zinc-500 uppercase tracking-widest font-mono">最近使用 / 配置集</span>
                        </div>
                        <div className="flex flex-wrap gap-3">
                            <TooltipProvider>
                                {history.map((h, i) => (
                                    <Tooltip key={i}>
                                        <TooltipTrigger asChild>
                                            <div 
                                                className="w-10 h-10 md:w-12 md:h-12 rounded-xl border-2 border-white dark:border-zinc-800 shadow-sm cursor-pointer hover:scale-110 active:scale-95 transition-all"
                                                style={{ backgroundColor: h }}
                                                onClick={() => handleColorChange(h)}
                                            />
                                        </TooltipTrigger>
                                        <TooltipContent side="bottom">
                                            <p className="font-mono">{h}</p>
                                        </TooltipContent>
                                    </Tooltip>
                                ))}
                            </TooltipProvider>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}

// 辅助函数：Hex 转 RGB
function hexToRgb(hex: string) {
    hex = hex.replace('#', '')
    if (hex.length === 3) {
        hex = hex.split('').map(char => char + char).join('')
    }
    const r = parseInt(hex.substring(0, 2), 16)
    const g = parseInt(hex.substring(2, 4), 16)
    const b = parseInt(hex.substring(4, 6), 16)
    return `rgb(${r}, ${g}, ${b})`
}

// 辅助函数：Hex 转 HSL
function hexToHsl(hex: string) {
    hex = hex.replace('#', '')
    let r = parseInt(hex.substring(0, 2), 16) / 255
    let g = parseInt(hex.substring(2, 4), 16) / 255
    let b = parseInt(hex.substring(4, 6), 16) / 255

    const max = Math.max(r, g, b), min = Math.min(r, g, b)
    let h = 0, s = 0, l = (max + min) / 2

    if (max !== min) {
        const d = max - min
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break
            case g: h = (b - r) / d + 2; break
            case b: h = (r - g) / d + 4; break
        }
        h /= 6
    }

    return `hsl(${Math.round(h * 360)}°, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`
}
