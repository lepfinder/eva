/**
 * 密码生成器工具
 * 支持生成复杂安全的密码
 */
import { useState, useCallback } from 'react'
import { Key, Copy, Check, RefreshCw, Shield, ShieldCheck, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

// 字符集
const CHAR_SETS = {
    uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    lowercase: 'abcdefghijklmnopqrstuvwxyz',
    numbers: '0123456789',
    symbols: '!@#$%^&*()_+-=[]{}|;:,.<>?'
}

// 相似字符
const SIMILAR_CHARS = '0O1lI'

interface PasswordOptions {
    length: number
    uppercase: boolean
    lowercase: boolean
    numbers: boolean
    symbols: boolean
    excludeSimilar: boolean
}

// 计算密码强度
function calculateStrength(options: PasswordOptions): { level: number; label: string; color: string } {
    let poolSize = 0
    if (options.uppercase) poolSize += 26
    if (options.lowercase) poolSize += 26
    if (options.numbers) poolSize += 10
    if (options.symbols) poolSize += CHAR_SETS.symbols.length

    const entropy = options.length * Math.log2(Math.max(1, poolSize))

    if (entropy < 28) return { level: 1, label: '非常弱', color: 'text-red-500' }
    if (entropy < 36) return { level: 2, label: '弱', color: 'text-orange-500' }
    if (entropy < 60) return { level: 3, label: '中等', color: 'text-yellow-500' }
    if (entropy < 128) return { level: 4, label: '强', color: 'text-green-500' }
    return { level: 5, label: '非常强', color: 'text-emerald-600' }
}

// 生成密码
function generatePassword(options: PasswordOptions): string {
    let chars = ''
    if (options.uppercase) chars += CHAR_SETS.uppercase
    if (options.lowercase) chars += CHAR_SETS.lowercase
    if (options.numbers) chars += CHAR_SETS.numbers
    if (options.symbols) chars += CHAR_SETS.symbols

    if (options.excludeSimilar) {
        chars = chars.split('').filter(c => !SIMILAR_CHARS.includes(c)).join('')
    }

    if (chars.length === 0) {
        return ''
    }

    // 使用 crypto API 生成安全随机数
    const array = new Uint32Array(options.length)
    crypto.getRandomValues(array)

    let password = ''
    for (let i = 0; i < options.length; i++) {
        password += chars[array[i] % chars.length]
    }

    return password
}

export function PasswordGenerator(): React.ReactElement {
    const [options, setOptions] = useState<PasswordOptions>({
        length: 16,
        uppercase: true,
        lowercase: true,
        numbers: true,
        symbols: true,
        excludeSimilar: false
    })

    const [passwords, setPasswords] = useState<string[]>([])
    const [copiedIndex, setCopiedIndex] = useState<number | null>(null)
    const [passwordCount, setPasswordCount] = useState(5)

    const strength = calculateStrength(options)

    // 生成密码
    const handleGenerate = useCallback(() => {
        const newPasswords: string[] = []
        for (let i = 0; i < passwordCount; i++) {
            newPasswords.push(generatePassword(options))
        }
        setPasswords(newPasswords)
        setCopiedIndex(null)
    }, [options, passwordCount])

    // 复制密码
    const handleCopy = useCallback(async (password: string, index: number) => {
        try {
            await navigator.clipboard.writeText(password)
            setCopiedIndex(index)
            setTimeout(() => setCopiedIndex(null), 2000)
        } catch (err) {
            console.error('Copy failed:', err)
        }
    }, [])

    // 更新选项
    const updateOption = <K extends keyof PasswordOptions>(key: K, value: PasswordOptions[K]) => {
        setOptions(prev => ({ ...prev, [key]: value }))
    }

    // 检查是否有选中的字符类型
    const hasCharType = options.uppercase || options.lowercase || options.numbers || options.symbols

    return (
        <div className="h-full flex flex-col overflow-hidden">
            {/* 页面头部 */}
            <div className="shrink-0 flex items-center gap-3 mb-6">
                <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg">
                    <Key className="h-5 w-5 text-white" />
                </div>
                <div>
                    <h1 className="text-xl font-semibold text-zinc-900">密码生成器</h1>
                    <p className="text-sm text-zinc-500">生成安全复杂的随机密码</p>
                </div>
            </div>

            <div className="flex-1 min-h-0 grid grid-cols-2 gap-6 overflow-auto">
                {/* 左侧：配置选项 */}
                <Card className="bg-white border-zinc-200 shadow-sm">
                    <CardHeader>
                        <CardTitle className="text-base font-medium text-zinc-900 flex items-center gap-2">
                            <Shield className="h-4 w-4 text-violet-600" />
                            密码选项
                        </CardTitle>
                        <CardDescription className="text-xs text-zinc-500">
                            配置密码生成规则
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        {/* 密码长度 */}
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <Label className="text-sm font-medium text-zinc-700">密码长度</Label>
                                <span className="text-sm font-mono text-violet-600 bg-violet-50 px-2 py-0.5 rounded">
                                    {options.length} 位
                                </span>
                            </div>
                            <Slider
                                value={[options.length]}
                                onValueChange={([value]) => updateOption('length', value)}
                                min={8}
                                max={64}
                                step={1}
                                className="w-full"
                            />
                            <div className="flex justify-between text-xs text-zinc-400">
                                <span>8</span>
                                <span>64</span>
                            </div>
                        </div>

                        {/* 字符类型 */}
                        <div className="space-y-3">
                            <Label className="text-sm font-medium text-zinc-700">包含字符</Label>

                            <div className="space-y-3">
                                <div className="flex items-center justify-between p-3 rounded-lg bg-zinc-50 border border-zinc-200">
                                    <div className="flex items-center gap-3">
                                        <span className="text-sm font-mono text-zinc-600 bg-white px-2 py-1 rounded border">A-Z</span>
                                        <span className="text-sm text-zinc-600">大写字母</span>
                                    </div>
                                    <Switch
                                        checked={options.uppercase}
                                        onCheckedChange={(checked) => updateOption('uppercase', checked)}
                                    />
                                </div>

                                <div className="flex items-center justify-between p-3 rounded-lg bg-zinc-50 border border-zinc-200">
                                    <div className="flex items-center gap-3">
                                        <span className="text-sm font-mono text-zinc-600 bg-white px-2 py-1 rounded border">a-z</span>
                                        <span className="text-sm text-zinc-600">小写字母</span>
                                    </div>
                                    <Switch
                                        checked={options.lowercase}
                                        onCheckedChange={(checked) => updateOption('lowercase', checked)}
                                    />
                                </div>

                                <div className="flex items-center justify-between p-3 rounded-lg bg-zinc-50 border border-zinc-200">
                                    <div className="flex items-center gap-3">
                                        <span className="text-sm font-mono text-zinc-600 bg-white px-2 py-1 rounded border">0-9</span>
                                        <span className="text-sm text-zinc-600">数字</span>
                                    </div>
                                    <Switch
                                        checked={options.numbers}
                                        onCheckedChange={(checked) => updateOption('numbers', checked)}
                                    />
                                </div>

                                <div className="flex items-center justify-between p-3 rounded-lg bg-zinc-50 border border-zinc-200">
                                    <div className="flex items-center gap-3">
                                        <span className="text-sm font-mono text-zinc-600 bg-white px-2 py-1 rounded border">!@#</span>
                                        <span className="text-sm text-zinc-600">特殊符号</span>
                                    </div>
                                    <Switch
                                        checked={options.symbols}
                                        onCheckedChange={(checked) => updateOption('symbols', checked)}
                                    />
                                </div>
                            </div>
                        </div>

                        {/* 其他选项 */}
                        <div className="space-y-3">
                            <Label className="text-sm font-medium text-zinc-700">其他选项</Label>

                            <div className="flex items-center justify-between p-3 rounded-lg bg-zinc-50 border border-zinc-200">
                                <div>
                                    <span className="text-sm text-zinc-600">排除相似字符</span>
                                    <p className="text-xs text-zinc-400 mt-0.5">排除 0/O, 1/l/I 等易混淆字符</p>
                                </div>
                                <Switch
                                    checked={options.excludeSimilar}
                                    onCheckedChange={(checked) => updateOption('excludeSimilar', checked)}
                                />
                            </div>
                        </div>

                        {/* 密码强度 */}
                        <div className="space-y-3">
                            <Label className="text-sm font-medium text-zinc-700">密码强度</Label>
                            <div className="flex items-center gap-3 p-3 rounded-lg bg-zinc-50 border border-zinc-200">
                                {strength.level >= 4 ? (
                                    <ShieldCheck className={cn("h-5 w-5", strength.color)} />
                                ) : strength.level >= 2 ? (
                                    <Shield className={cn("h-5 w-5", strength.color)} />
                                ) : (
                                    <ShieldAlert className={cn("h-5 w-5", strength.color)} />
                                )}
                                <div className="flex-1">
                                    <div className="flex items-center justify-between mb-1">
                                        <span className={cn("text-sm font-medium", strength.color)}>{strength.label}</span>
                                    </div>
                                    <div className="h-1.5 bg-zinc-200 rounded-full overflow-hidden">
                                        <div
                                            className={cn(
                                                "h-full transition-all duration-300 rounded-full",
                                                strength.level === 1 && "bg-red-500",
                                                strength.level === 2 && "bg-orange-500",
                                                strength.level === 3 && "bg-yellow-500",
                                                strength.level === 4 && "bg-green-500",
                                                strength.level === 5 && "bg-emerald-600"
                                            )}
                                            style={{ width: `${(strength.level / 5) * 100}%` }}
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* 生成数量 */}
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <Label className="text-sm font-medium text-zinc-700">生成数量</Label>
                                <span className="text-sm font-mono text-violet-600 bg-violet-50 px-2 py-0.5 rounded">
                                    {passwordCount} 个
                                </span>
                            </div>
                            <Slider
                                value={[passwordCount]}
                                onValueChange={([value]) => setPasswordCount(value)}
                                min={1}
                                max={10}
                                step={1}
                                className="w-full"
                            />
                        </div>

                        {/* 生成按钮 */}
                        <Button
                            onClick={handleGenerate}
                            disabled={!hasCharType}
                            className="w-full gap-2 bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 text-white shadow-lg"
                        >
                            <RefreshCw className="h-4 w-4" />
                            生成密码
                        </Button>
                    </CardContent>
                </Card>

                {/* 右侧：生成结果 */}
                <Card className="bg-white border-zinc-200 shadow-sm">
                    <CardHeader>
                        <CardTitle className="text-base font-medium text-zinc-900 flex items-center gap-2">
                            <Key className="h-4 w-4 text-violet-600" />
                            生成结果
                        </CardTitle>
                        <CardDescription className="text-xs text-zinc-500">
                            点击密码可复制到剪贴板
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        {passwords.length === 0 ? (
                            <div className="h-[400px] flex flex-col items-center justify-center text-zinc-400">
                                <Key className="h-12 w-12 mb-3 opacity-30" />
                                <p className="text-sm">配置选项后点击"生成密码"</p>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {passwords.map((password, index) => (
                                    <div
                                        key={index}
                                        className={cn(
                                            "group flex items-center justify-between p-3 rounded-lg border transition-all cursor-pointer",
                                            copiedIndex === index
                                                ? "bg-green-50 border-green-200"
                                                : "bg-zinc-50 border-zinc-200 hover:bg-violet-50 hover:border-violet-200"
                                        )}
                                        onClick={() => handleCopy(password, index)}
                                    >
                                        <code className="flex-1 text-sm font-mono text-zinc-800 break-all select-all">
                                            {password}
                                        </code>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className={cn(
                                                "h-8 w-8 ml-2 shrink-0",
                                                copiedIndex === index
                                                    ? "text-green-600"
                                                    : "text-zinc-400 hover:text-violet-600"
                                            )}
                                        >
                                            {copiedIndex === index ? (
                                                <Check className="h-4 w-4" />
                                            ) : (
                                                <Copy className="h-4 w-4" />
                                            )}
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
