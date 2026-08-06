/**
 * Vault Page - 保险箱模块
 * 使用 Touch ID 保护的本地加密存储空间
 */

import { useState, useEffect, useCallback } from 'react'
import { Lock, Unlock, Plus, FileText, Image, Search, Trash2, Save, X, Loader2, Eye, EyeOff, Edit, ZoomIn, KeyRound, Copy, Check, Download, Globe, User, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

// Vault 数据类型
interface VaultAttachment {
    id: string
    name: string
    data: string // Base64 encoded
}

interface VaultItem {
    id: string
    title: string
    type: 'document' | 'note' | 'mfa' | 'password'
    createdAt: number
    updatedAt: number
    content?: string
    attachments?: VaultAttachment[]
    // MFA 专用字段
    mfaSecret?: string // TOTP 密钥 (Base32 编码)
    mfaIssuer?: string // 发行方名称
    // Password 专用字段
    passwordUsername?: string // 用户名
    passwordValue?: string // 密码
    passwordUrl?: string // 网站 URL
    passwordNotes?: string // 备注
}

// ==================== TOTP 实现 (RFC 6238) ====================

// Base32 解码表
const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function base32Decode(encoded: string): Uint8Array {
    // 移除空格和连字符，转大写
    const cleaned = encoded.replace(/[\s-]/g, '').toUpperCase()
    const output: number[] = []
    let buffer = 0
    let bitsLeft = 0

    for (const char of cleaned) {
        if (char === '=') break // 填充字符
        const val = BASE32_CHARS.indexOf(char)
        if (val === -1) continue // 忽略无效字符

        buffer = (buffer << 5) | val
        bitsLeft += 5

        if (bitsLeft >= 8) {
            bitsLeft -= 8
            output.push((buffer >> bitsLeft) & 0xff)
        }
    }

    return new Uint8Array(output)
}

// HMAC-SHA1 实现
async function hmacSha1(key: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
    // 创建新的 ArrayBuffer 副本以避免类型问题
    const keyBuffer = new ArrayBuffer(key.length)
    new Uint8Array(keyBuffer).set(key)
    const msgBuffer = new ArrayBuffer(message.length)
    new Uint8Array(msgBuffer).set(message)

    const cryptoKey = await crypto.subtle.importKey(
        'raw',
        keyBuffer,
        { name: 'HMAC', hash: 'SHA-1' },
        false,
        ['sign']
    )
    const signature = await crypto.subtle.sign('HMAC', cryptoKey, msgBuffer)
    return new Uint8Array(signature)
}

// 生成 TOTP 代码
async function generateTOTP(secret: string, timeStep = 30, digits = 6): Promise<string> {
    try {
        const key = base32Decode(secret)
        const time = Math.floor(Date.now() / 1000 / timeStep)

        // 将时间转为 8 字节大端序
        const timeBytes = new Uint8Array(8)
        let t = time
        for (let i = 7; i >= 0; i--) {
            timeBytes[i] = t & 0xff
            t = Math.floor(t / 256)
        }

        const hmac = await hmacSha1(key, timeBytes)

        // 动态截断
        const offset = hmac[hmac.length - 1] & 0x0f
        const binary =
            ((hmac[offset] & 0x7f) << 24) |
            ((hmac[offset + 1] & 0xff) << 16) |
            ((hmac[offset + 2] & 0xff) << 8) |
            (hmac[offset + 3] & 0xff)

        const otp = binary % Math.pow(10, digits)
        return otp.toString().padStart(digits, '0')
    } catch {
        return '------'
    }
}


// 计算剩余秒数
function getRemainingSeconds(timeStep = 30): number {
    return timeStep - (Math.floor(Date.now() / 1000) % timeStep)
}

// ==================== MFA 编辑器组件 ====================
interface MFAEditorProps {
    secret: string
    issuer: string
    onSecretChange: (secret: string) => void
    onIssuerChange: (issuer: string) => void
}

function MFAEditor({ secret, issuer, onSecretChange, onIssuerChange }: MFAEditorProps) {
    const [totpCode, setTotpCode] = useState('------')
    const [remainingSeconds, setRemainingSeconds] = useState(30)
    const [copied, setCopied] = useState(false)

    // 实时更新 TOTP 码
    useEffect(() => {
        if (!secret || secret.length < 16) {
            setTotpCode('------')
            return
        }

        const updateCode = async () => {
            const code = await generateTOTP(secret)
            setTotpCode(code)
            setRemainingSeconds(getRemainingSeconds())
        }

        updateCode()
        const interval = setInterval(updateCode, 1000)
        return () => clearInterval(interval)
    }, [secret])

    // 复制验证码
    const handleCopy = async () => {
        if (totpCode !== '------') {
            await navigator.clipboard.writeText(totpCode)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
        }
    }

    return (
        <div className="space-y-6">
            {/* 发行方 */}
            <div className="space-y-2">
                <label className="text-sm font-medium">发行方 / 服务名称</label>
                <Input
                    value={issuer}
                    onChange={e => onIssuerChange(e.target.value)}
                    placeholder="例如：GitHub, Google, AWS..."
                />
            </div>

            {/* 密钥 */}
            <div className="space-y-2">
                <label className="text-sm font-medium">TOTP 密钥 (Base32)</label>
                <Input
                    value={secret}
                    onChange={e => onSecretChange(e.target.value.replace(/\s/g, '').toUpperCase())}
                    placeholder="JBSWY3DPEHPK3PXP..."
                    className="font-mono"
                />
                <p className="text-xs text-muted-foreground">
                    通常在服务的 2FA 设置页面获取，格式为 Base32 编码的字符串（仅包含 A-Z 和 2-7）
                </p>
            </div>

            {/* 实时验证码预览 */}
            {secret && secret.length >= 16 && (
                <div className="p-6 bg-muted/50 rounded-xl border">
                    <div className="text-center">
                        <p className="text-sm text-muted-foreground mb-2">当前验证码</p>
                        <div className="flex items-center justify-center gap-4">
                            <span className="text-4xl font-mono font-bold tracking-[0.5em]">
                                {totpCode.slice(0, 3)} {totpCode.slice(3)}
                            </span>
                            <Button
                                variant="outline"
                                size="icon"
                                onClick={handleCopy}
                                className="shrink-0"
                            >
                                {copied ? (
                                    <Check className="w-4 h-4 text-green-500" />
                                ) : (
                                    <Copy className="w-4 h-4" />
                                )}
                            </Button>
                        </div>
                        {/* 倒计时进度条 */}
                        <div className="mt-4 w-full h-1.5 bg-muted rounded-full overflow-hidden">
                            <div
                                className="h-full bg-primary transition-all duration-1000 ease-linear"
                                style={{ width: `${(remainingSeconds / 30) * 100}%` }}
                            />
                        </div>
                        <p className="text-xs text-muted-foreground mt-2">
                            {remainingSeconds} 秒后更新
                        </p>
                    </div>
                </div>
            )}
        </div>
    )
}

// ==================== MFA 卡片预览组件（列表中显示） ====================
interface MFACardPreviewProps {
    secret: string
    issuer?: string
}

function MFACardPreview({ secret, issuer }: MFACardPreviewProps) {
    const [totpCode, setTotpCode] = useState('------')
    const [remainingSeconds, setRemainingSeconds] = useState(30)
    const [copied, setCopied] = useState(false)

    useEffect(() => {
        if (!secret || secret.length < 16) return

        const updateCode = async () => {
            const code = await generateTOTP(secret)
            setTotpCode(code)
            setRemainingSeconds(getRemainingSeconds())
        }

        updateCode()
        const interval = setInterval(updateCode, 1000)
        return () => clearInterval(interval)
    }, [secret])

    // 复制验证码
    const handleCopy = async (e: React.MouseEvent) => {
        e.stopPropagation() // 阻止点击冒泡到卡片
        if (totpCode !== '------') {
            await navigator.clipboard.writeText(totpCode)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
        }
    }

    return (
        <div className="space-y-2">
            {issuer && (
                <p className="text-xs text-muted-foreground">{issuer}</p>
            )}
            <div className="flex items-center justify-between gap-2">
                <span className="text-2xl font-mono font-bold tracking-wider">
                    {totpCode.slice(0, 3)} {totpCode.slice(3)}
                </span>
                <div className="flex items-center gap-2">
                    {/* 复制按钮 */}
                    <Button
                        variant="outline"
                        size="icon"
                        className="h-8 w-8 shrink-0"
                        onClick={handleCopy}
                    >
                        {copied ? (
                            <Check className="w-4 h-4 text-green-500" />
                        ) : (
                            <Copy className="w-4 h-4" />
                        )}
                    </Button>
                    {/* 倒计时圆圈 */}
                    <div className="w-8 h-8 rounded-full border-2 border-primary flex items-center justify-center shrink-0">
                        <span className="text-xs font-mono">{remainingSeconds}</span>
                    </div>
                </div>
            </div>
        </div>
    )
}

// ==================== 密码编辑器组件 ====================
interface PasswordEditorProps {
    username: string
    password: string
    url: string
    notes: string
    onUsernameChange: (username: string) => void
    onPasswordChange: (password: string) => void
    onUrlChange: (url: string) => void
    onNotesChange: (notes: string) => void
    readOnly?: boolean
}

function PasswordEditor({
    username,
    password,
    url,
    notes,
    onUsernameChange,
    onPasswordChange,
    onUrlChange,
    onNotesChange,
    readOnly = false
}: PasswordEditorProps) {
    const [showPassword, setShowPassword] = useState(false)
    const [copiedField, setCopiedField] = useState<string | null>(null)

    const handleCopy = async (value: string, field: string) => {
        await navigator.clipboard.writeText(value)
        setCopiedField(field)
        setTimeout(() => setCopiedField(null), 2000)
    }

    // 只读模式 - 类似参考图片的样式
    if (readOnly) {
        return (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* 左列 */}
                <div className="space-y-6">
                    {/* 用户名 */}
                    <div className="space-y-2">
                        <label className="text-sm text-muted-foreground">用户名</label>
                        <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg">
                            <span className="flex-1 truncate font-medium">{username || '未设置'}</span>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 shrink-0"
                                onClick={() => handleCopy(username, 'username')}
                                disabled={!username}
                            >
                                {copiedField === 'username' ? (
                                    <Check className="w-4 h-4 text-green-500" />
                                ) : (
                                    <Copy className="w-4 h-4" />
                                )}
                            </Button>
                        </div>
                    </div>

                    {/* 密码 */}
                    <div className="space-y-2">
                        <label className="text-sm text-muted-foreground">密码</label>
                        <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg">
                            <span className="flex-1 font-mono">
                                {showPassword ? password : '••••••••••••'}
                            </span>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 shrink-0"
                                onClick={() => setShowPassword(!showPassword)}
                            >
                                {showPassword ? (
                                    <EyeOff className="w-4 h-4" />
                                ) : (
                                    <Eye className="w-4 h-4" />
                                )}
                            </Button>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 shrink-0"
                                onClick={() => handleCopy(password, 'password')}
                                disabled={!password}
                            >
                                {copiedField === 'password' ? (
                                    <Check className="w-4 h-4 text-green-500" />
                                ) : (
                                    <Copy className="w-4 h-4" />
                                )}
                            </Button>
                        </div>
                    </div>
                </div>

                {/* 右列 */}
                <div className="space-y-6">
                    {/* 网站 */}
                    <div className="space-y-2">
                        <label className="text-sm text-muted-foreground">网站</label>
                        <div className="p-3 bg-muted/50 rounded-lg">
                            {url ? (
                                <a
                                    href="#"
                                    onClick={(e) => { e.preventDefault(); window.api.openInBrowser(url) }}
                                    className="text-primary hover:underline break-all"
                                >
                                    {url}
                                </a>
                            ) : (
                                <span className="text-muted-foreground">未设置</span>
                            )}
                        </div>
                    </div>

                    {/* 备注 */}
                    <div className="space-y-2">
                        <label className="text-sm text-muted-foreground">备注</label>
                        <div className="p-3 bg-muted/50 rounded-lg min-h-[80px]">
                            <span className="text-muted-foreground">
                                {notes || '未添加任何备注'}
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        )
    }

    // 编辑模式
    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* 左列 */}
            <div className="space-y-6">
                {/* 用户名 */}
                <div className="space-y-2">
                    <label className="text-sm font-medium">用户名</label>
                    <div className="relative">
                        <Input
                            value={username}
                            onChange={e => onUsernameChange(e.target.value)}
                            placeholder="输入用户名或邮箱..."
                            className="pr-10"
                        />
                        <Button
                            variant="ghost"
                            size="icon"
                            className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8"
                            onClick={() => handleCopy(username, 'username')}
                            disabled={!username}
                        >
                            {copiedField === 'username' ? (
                                <Check className="w-4 h-4 text-green-500" />
                            ) : (
                                <Copy className="w-4 h-4" />
                            )}
                        </Button>
                    </div>
                </div>

                {/* 密码 */}
                <div className="space-y-2">
                    <label className="text-sm font-medium">密码</label>
                    <div className="relative">
                        <Input
                            type={showPassword ? 'text' : 'password'}
                            value={password}
                            onChange={e => onPasswordChange(e.target.value)}
                            placeholder="输入密码..."
                            className="pr-20 font-mono"
                        />
                        <div className="absolute right-1 top-1/2 -translate-y-1/2 flex gap-1">
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => setShowPassword(!showPassword)}
                            >
                                {showPassword ? (
                                    <EyeOff className="w-4 h-4" />
                                ) : (
                                    <Eye className="w-4 h-4" />
                                )}
                            </Button>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => handleCopy(password, 'password')}
                                disabled={!password}
                            >
                                {copiedField === 'password' ? (
                                    <Check className="w-4 h-4 text-green-500" />
                                ) : (
                                    <Copy className="w-4 h-4" />
                                )}
                            </Button>
                        </div>
                    </div>
                </div>
            </div>

            {/* 右列 */}
            <div className="space-y-6">
                {/* 网站 */}
                <div className="space-y-2">
                    <label className="text-sm font-medium">网站</label>
                    <div className="relative">
                        <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input
                            value={url}
                            onChange={e => onUrlChange(e.target.value)}
                            placeholder="https://..."
                            className="pl-10 pr-10"
                        />
                        {url && (
                            <Button
                                variant="ghost"
                                size="icon"
                                className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8"
                                onClick={() => window.api.openInBrowser(url)}
                            >
                                <ExternalLink className="w-4 h-4" />
                            </Button>
                        )}
                    </div>
                </div>

                {/* 备注 */}
                <div className="space-y-2">
                    <label className="text-sm font-medium">备注</label>
                    <textarea
                        className="w-full min-h-[80px] p-3 rounded-md border border-input bg-background resize-y text-sm"
                        value={notes}
                        onChange={e => onNotesChange(e.target.value)}
                        placeholder="添加备注..."
                    />
                </div>
            </div>
        </div>
    )
}

// ==================== 密码卡片预览组件（列表中显示） ====================
interface PasswordCardPreviewProps {
    username?: string
    password?: string
    url?: string
    notes?: string
}

function PasswordCardPreview({ username, url }: PasswordCardPreviewProps) {
    const [copiedField, setCopiedField] = useState<string | null>(null)

    const handleCopy = async (e: React.MouseEvent, value: string, field: string) => {
        e.stopPropagation()
        await navigator.clipboard.writeText(value)
        setCopiedField(field)
        setTimeout(() => setCopiedField(null), 2000)
    }

    const handleOpenUrl = (e: React.MouseEvent) => {
        e.stopPropagation()
        if (url) {
            window.api.openInBrowser(url)
        }
    }

    // 提取域名显示
    const getDomain = (urlStr: string) => {
        try {
            const urlObj = new URL(urlStr)
            return urlObj.hostname
        } catch {
            return urlStr
        }
    }

    return (
        <div className="space-y-2">
            {/* 用户名 */}
            {username && (
                <div className="flex items-center gap-2 text-sm">
                    <User className="w-4 h-4 text-muted-foreground shrink-0" />
                    <span className="truncate flex-1">{username}</span>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 shrink-0"
                        onClick={(e) => handleCopy(e, username, 'username')}
                    >
                        {copiedField === 'username' ? (
                            <Check className="w-3 h-3 text-green-500" />
                        ) : (
                            <Copy className="w-3 h-3" />
                        )}
                    </Button>
                </div>
            )}

            {/* 网站 */}
            {url && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Globe className="w-4 h-4 shrink-0" />
                    <a
                        href="#"
                        onClick={handleOpenUrl}
                        className="truncate flex-1 text-primary hover:underline"
                    >
                        {getDomain(url)}
                    </a>
                </div>
            )}
        </div>
    )
}

interface VaultStore {
    items: VaultItem[]
}

// 默认自动锁定超时时间（5分钟）
let currentAutoLockTimeout = 5 * 60 * 1000

// ==================== 全局认证缓存（跨页面切换保持） ====================
// 这些变量在模块级别保存，页面切换不会丢失
let cachedUnlockTime: number | null = null
let cachedVaultData: VaultStore | null = null

// 检查缓存是否有效
function isCacheValid(): boolean {
    if (!cachedUnlockTime || !cachedVaultData) return false
    return Date.now() - cachedUnlockTime < currentAutoLockTimeout
}

// 保存到缓存
function saveToCache(data: VaultStore) {
    cachedUnlockTime = Date.now()
    cachedVaultData = data
}

// 清除缓存
function clearCache() {
    cachedUnlockTime = null
    cachedVaultData = null
}

// 更新缓存活动时间
function refreshCacheTime() {
    if (cachedUnlockTime) {
        cachedUnlockTime = Date.now()
    }
}

export function VaultPage(): React.ReactElement {
    // 状态管理 - 初始化时检查缓存
    const [isUnlocked, setIsUnlocked] = useState(() => isCacheValid())
    const [isUnlocking, setIsUnlocking] = useState(false)
    const [error, setError] = useState<string | null>(null)

    // 认证状态
    const [canUseBiometric, setCanUseBiometric] = useState(true) // 默认假设支持
    const [needPassword, setNeedPassword] = useState(false)
    const [needSetPassword, setNeedSetPassword] = useState(false)
    const [password, setPassword] = useState('')
    const [confirmPassword, setConfirmPassword] = useState('')

    // 数据状态 - 从缓存恢复
    const [vaultData, setVaultData] = useState<VaultStore>(() =>
        isCacheValid() && cachedVaultData ? cachedVaultData : { items: [] }
    )
    const [searchQuery, setSearchQuery] = useState('')
    const [activeTab, setActiveTab] = useState<'all' | 'document' | 'note' | 'mfa' | 'password'>('all')

    // 编辑模式
    const [editingItem, setEditingItem] = useState<VaultItem | null>(null)
    const [isCreating, setIsCreating] = useState(false)
    const [isPreviewMode, setIsPreviewMode] = useState(false)

    // 图片预览
    const [previewImage, setPreviewImage] = useState<{ src: string; name: string } | null>(null)

    // 自动锁定定时器
    const [lastActivity, setLastActivity] = useState(Date.now())

    // 加载自动锁定配置
    useEffect(() => {
        window.api.settingsGetAll().then(settings => {
            if (settings && settings.vaultAutoLockMinutes) {
                currentAutoLockTimeout = settings.vaultAutoLockMinutes * 60 * 1000
            }
        })
    }, [])

    // 更新活动时间
    const updateActivity = useCallback(() => {
        setLastActivity(Date.now())
        refreshCacheTime() // 同步更新缓存时间
    }, [])

    // 自动锁定逻辑
    useEffect(() => {
        if (!isUnlocked) return

        const checkAutoLock = setInterval(() => {
            if (Date.now() - lastActivity > currentAutoLockTimeout) {
                handleLock()
            }
        }, 10000) // 每10秒检查

        return () => clearInterval(checkAutoLock)
    }, [isUnlocked, lastActivity])

    // 监听窗口失焦自动锁定
    useEffect(() => {
        const handleBlur = () => {
            if (isUnlocked) {
                // 窗口失焦后立即锁定（可选，当前注释掉）
                // handleLock()
            }
        }

        window.addEventListener('blur', handleBlur)
        window.addEventListener('mousemove', updateActivity)
        window.addEventListener('keydown', updateActivity)

        return () => {
            window.removeEventListener('blur', handleBlur)
            window.removeEventListener('mousemove', updateActivity)
            window.removeEventListener('keydown', updateActivity)
        }
    }, [isUnlocked, updateActivity])

    // 进入页面时启用内容保护并检测认证方式
    useEffect(() => {
        window.api.vaultSetContentProtection(true)
        // 检测生物识别支持
        window.api.vaultCanUseBiometric().then(setCanUseBiometric)
        return () => {
            window.api.vaultSetContentProtection(false)
        }
    }, [])

    // 不再自动触发指纹解锁，等待用户点击按钮

    // 解锁保险箱
    const handleUnlock = async () => {
        setIsUnlocking(true)
        setError(null)

        try {
            const result = await window.api.vaultUnlock()

            if (result.success && result.data) {
                setVaultData(result.data)
                setIsUnlocked(true)
                setLastActivity(Date.now())
                saveToCache(result.data) // 保存到缓存
                setNeedPassword(false)
            } else if (result.needPassword) {
                // 需要密码认证
                setNeedPassword(true)
                // 检查是否已设置密码
                const hasPassword = await window.api.vaultHasPassword()
                setNeedSetPassword(!hasPassword)
            } else {
                setError(result.error || '解锁失败')
            }
        } catch (err) {
            setError((err as Error).message)
        } finally {
            setIsUnlocking(false)
        }
    }

    // 使用密码解锁
    const handleUnlockWithPassword = async () => {
        if (!password) {
            setError('请输入密码')
            return
        }

        setIsUnlocking(true)
        setError(null)

        try {
            const result = await window.api.vaultUnlockWithPassword(password)

            if (result.success && result.data) {
                setVaultData(result.data)
                setIsUnlocked(true)
                setLastActivity(Date.now())
                saveToCache(result.data)
                setNeedPassword(false)
                setPassword('')
            } else if (result.needSetPassword) {
                setNeedSetPassword(true)
            } else {
                setError(result.error || '密码错误')
            }
        } catch (err) {
            setError((err as Error).message)
        } finally {
            setIsUnlocking(false)
        }
    }

    // 设置超级密码
    const handleSetPassword = async () => {
        if (!password || password.length < 6) {
            setError('密码至少6位')
            return
        }
        if (password !== confirmPassword) {
            setError('两次输入的密码不一致')
            return
        }

        setIsUnlocking(true)
        setError(null)

        try {
            const success = await window.api.vaultSetPassword(password)
            if (success) {
                // 设置成功后用密码解锁
                await handleUnlockWithPassword()
                setNeedSetPassword(false)
            } else {
                setError('设置密码失败')
            }
        } catch (err) {
            setError((err as Error).message)
        } finally {
            setIsUnlocking(false)
        }
    }

    // 锁定保险箱
    const handleLock = async () => {
        await window.api.vaultLock()
        setVaultData({ items: [] }) // 清空内存中的数据
        setIsUnlocked(false)
        setEditingItem(null)
        setIsCreating(false)
        clearCache() // 清除缓存
    }

    // 添加新项目
    const handleAddItem = (type: 'document' | 'note' | 'mfa' | 'password') => {
        const titleMap = {
            note: '新笔记',
            mfa: '新 MFA',
            document: '新证件',
            password: '新密码'
        }
        const newItem: VaultItem = {
            id: `item-${Date.now()}`,
            title: titleMap[type],
            type,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            content: type === 'note' ? '' : undefined,
            attachments: type === 'document' ? [] : undefined,
            mfaSecret: type === 'mfa' ? '' : undefined,
            mfaIssuer: type === 'mfa' ? '' : undefined,
            passwordUsername: type === 'password' ? '' : undefined,
            passwordValue: type === 'password' ? '' : undefined,
            passwordUrl: type === 'password' ? '' : undefined,
            passwordNotes: type === 'password' ? '' : undefined
        }
        setEditingItem(newItem)
        setIsCreating(true)
    }

    // 保存编辑的项目
    const handleSaveItem = async () => {
        if (!editingItem) return

        const updatedItem = { ...editingItem, updatedAt: Date.now() }

        let newItems: VaultItem[]
        if (isCreating) {
            newItems = [...vaultData.items, updatedItem]
        } else {
            newItems = vaultData.items.map(item =>
                item.id === updatedItem.id ? updatedItem : item
            )
        }

        const newData = { items: newItems }
        setVaultData(newData)
        saveToCache(newData) // 同步更新缓存

        // 保存到磁盘
        await window.api.vaultSave(newData)

        setEditingItem(null)
        setIsCreating(false)
    }

    // 删除项目
    const handleDeleteItem = async (id: string) => {
        if (!confirm('确定要删除这个项目吗？')) return

        const newItems = vaultData.items.filter(item => item.id !== id)
        const newData = { items: newItems }
        setVaultData(newData)
        saveToCache(newData) // 同步更新缓存
        await window.api.vaultSave(newData)
    }

    // 图片上传
    const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!editingItem || !e.target.files) return

        const files = Array.from(e.target.files)

        files.forEach(file => {
            const reader = new FileReader()
            reader.onload = () => {
                const base64 = reader.result as string
                const attachment: VaultAttachment = {
                    id: `att-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                    name: file.name,
                    data: base64
                }

                setEditingItem(prev => {
                    if (!prev) return prev
                    return {
                        ...prev,
                        attachments: [...(prev.attachments || []), attachment]
                    }
                })
            }
            reader.readAsDataURL(file)
        })
    }

    // 删除附件
    const handleRemoveAttachment = (attachmentId: string) => {
        if (!confirm('确定要删除这张图片吗？')) return

        setEditingItem(prev => {
            if (!prev) return prev
            return {
                ...prev,
                attachments: (prev.attachments || []).filter(a => a.id !== attachmentId)
            }
        })
    }

    // 下载附件
    const handleDownloadAttachment = (attachment: VaultAttachment) => {
        // 将 Base64 转换为 Blob 并下载
        const link = document.createElement('a')
        link.href = attachment.data
        link.download = attachment.name
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
    }

    // 过滤项目
    const filteredItems = vaultData.items.filter(item => {
        const matchesSearch = item.title.toLowerCase().includes(searchQuery.toLowerCase())
        const matchesTab = activeTab === 'all' || item.type === activeTab
        return matchesSearch && matchesTab
    })

    // ======================== 渲染 ========================

    // 锁定状态 - 显示锁屏
    if (!isUnlocked) {
        return (
            <div className="flex flex-col items-center justify-center h-full">
                <div className="text-center space-y-6 w-full max-w-sm">
                    <div className="w-24 h-24 mx-auto rounded-full bg-muted flex items-center justify-center">
                        <Lock className="w-12 h-12 text-muted-foreground" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-bold">保险箱已锁定</h1>
                        <p className="text-muted-foreground mt-2">
                            {needSetPassword ? '首次使用请设置超级密码' :
                                needPassword ? '输入超级密码解锁' :
                                    canUseBiometric ? '使用指纹识别解锁' : '输入密码解锁'}
                        </p>
                    </div>

                    {/* 需要设置密码 */}
                    {needSetPassword && (
                        <div className="space-y-4">
                            <Input
                                type="password"
                                placeholder="设置超级密码 (至少6位)"
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                            />
                            <Input
                                type="password"
                                placeholder="确认密码"
                                value={confirmPassword}
                                onChange={e => setConfirmPassword(e.target.value)}
                            />
                            <Button
                                size="lg"
                                onClick={handleSetPassword}
                                disabled={isUnlocking}
                                className="w-full"
                            >
                                {isUnlocking ? (
                                    <>
                                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                        正在设置...
                                    </>
                                ) : (
                                    '设置密码并解锁'
                                )}
                            </Button>
                        </div>
                    )}

                    {/* 需要输入密码 */}
                    {needPassword && !needSetPassword && (
                        <div className="space-y-4">
                            <Input
                                type="password"
                                placeholder="输入超级密码"
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && handleUnlockWithPassword()}
                            />
                            <Button
                                size="lg"
                                onClick={handleUnlockWithPassword}
                                disabled={isUnlocking}
                                className="w-full"
                            >
                                {isUnlocking ? (
                                    <>
                                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                        正在验证...
                                    </>
                                ) : (
                                    <>
                                        <Unlock className="w-4 h-4 mr-2" />
                                        解锁保险箱
                                    </>
                                )}
                            </Button>
                        </div>
                    )}

                    {/* 生物识别解锁 */}
                    {!needPassword && !needSetPassword && (
                        <Button
                            size="lg"
                            onClick={handleUnlock}
                            disabled={isUnlocking}
                            className="min-w-[200px]"
                        >
                            {isUnlocking ? (
                                <>
                                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                    正在验证...
                                </>
                            ) : (
                                <>
                                    <Unlock className="w-4 h-4 mr-2" />
                                    {canUseBiometric ? '使用指纹解锁' : '解锁保险箱'}
                                </>
                            )}
                        </Button>
                    )}

                    {error && (
                        <p className="text-red-500 text-sm">{error}</p>
                    )}
                </div>
            </div>
        )
    }

    // 编辑模式
    if (editingItem) {
        return (
            <div className="space-y-6">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <h1 className="text-2xl font-bold">
                        {isCreating ? '新建' : '编辑'}
                        {editingItem.type === 'note' ? '笔记' :
                            editingItem.type === 'mfa' ? 'MFA' :
                                editingItem.type === 'password' ? '密码' : '证件'}
                    </h1>
                    <div className="flex gap-2">
                        <Button variant="outline" onClick={() => { setEditingItem(null); setIsCreating(false); }}>
                            <X className="w-4 h-4 mr-2" />
                            取消
                        </Button>
                        <Button onClick={handleSaveItem}>
                            <Save className="w-4 h-4 mr-2" />
                            保存
                        </Button>
                    </div>
                </div>

                {/* 编辑表单 */}
                <Card>
                    <CardContent className="pt-6 space-y-4">
                        {/* 标题 */}
                        <div className="space-y-2">
                            <label className="text-sm font-medium">标题</label>
                            <Input
                                value={editingItem.title}
                                onChange={e => setEditingItem({ ...editingItem, title: e.target.value })}
                                placeholder="输入标题..."
                            />
                        </div>

                        {/* 笔记内容 */}
                        {editingItem.type === 'note' && (
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <label className="text-sm font-medium">内容</label>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => setIsPreviewMode(!isPreviewMode)}
                                    >
                                        {isPreviewMode ? (
                                            <><Edit className="w-4 h-4 mr-1" /> 编辑</>
                                        ) : (
                                            <><Eye className="w-4 h-4 mr-1" /> 预览</>
                                        )}
                                    </Button>
                                </div>
                                {isPreviewMode ? (
                                    <div className="w-full min-h-[400px] max-h-[600px] overflow-auto p-4 rounded-md border border-input bg-muted/30 prose prose-sm dark:prose-invert max-w-none">
                                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                            {editingItem.content || '*暂无内容*'}
                                        </ReactMarkdown>
                                    </div>
                                ) : (
                                    <textarea
                                        className="w-full min-h-[400px] max-h-[600px] p-3 rounded-md border border-input bg-background resize-y font-mono text-sm"
                                        value={editingItem.content || ''}
                                        onChange={e => setEditingItem({ ...editingItem, content: e.target.value })}
                                        placeholder="输入笔记内容（支持 Markdown）..."
                                    />
                                )}
                            </div>
                        )}

                        {/* 证件图片 */}
                        {editingItem.type === 'document' && (
                            <div className="space-y-4">
                                <label className="text-sm font-medium">证件图片</label>

                                {/* 图片列表 */}
                                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                                    {(editingItem.attachments || []).map(att => (
                                        <div key={att.id} className="relative group">
                                            <img
                                                src={att.data}
                                                alt={att.name}
                                                className="w-full h-40 object-cover rounded-lg border cursor-pointer hover:border-primary transition-colors"
                                                onClick={() => setPreviewImage({ src: att.data, name: att.name })}
                                            />
                                            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center gap-2">
                                                <Button
                                                    variant="secondary"
                                                    size="sm"
                                                    onClick={() => setPreviewImage({ src: att.data, name: att.name })}
                                                >
                                                    <ZoomIn className="w-4 h-4" />
                                                </Button>
                                                <Button
                                                    variant="secondary"
                                                    size="sm"
                                                    onClick={() => handleDownloadAttachment(att)}
                                                >
                                                    <Download className="w-4 h-4" />
                                                </Button>
                                                <Button
                                                    variant="destructive"
                                                    size="sm"
                                                    onClick={() => handleRemoveAttachment(att.id)}
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </Button>
                                            </div>
                                            <p className="text-xs text-center mt-1 truncate">{att.name}</p>
                                        </div>
                                    ))}

                                    {/* 上传按钮 */}
                                    <label className="h-40 border-2 border-dashed rounded-lg flex flex-col items-center justify-center cursor-pointer hover:border-primary hover:bg-muted/50 transition-colors">
                                        <Plus className="w-8 h-8 text-muted-foreground" />
                                        <span className="text-sm text-muted-foreground mt-2">添加图片</span>
                                        <input
                                            type="file"
                                            accept="image/*"
                                            multiple
                                            className="hidden"
                                            onChange={handleImageUpload}
                                        />
                                    </label>
                                </div>
                            </div>
                        )}

                        {/* MFA 设置 */}
                        {editingItem.type === 'mfa' && (
                            <MFAEditor
                                secret={editingItem.mfaSecret || ''}
                                issuer={editingItem.mfaIssuer || ''}
                                onSecretChange={(secret) => setEditingItem({ ...editingItem, mfaSecret: secret })}
                                onIssuerChange={(issuer) => setEditingItem({ ...editingItem, mfaIssuer: issuer })}
                            />
                        )}

                        {/* 密码设置 */}
                        {editingItem.type === 'password' && (
                            <PasswordEditor
                                username={editingItem.passwordUsername || ''}
                                password={editingItem.passwordValue || ''}
                                url={editingItem.passwordUrl || ''}
                                notes={editingItem.passwordNotes || ''}
                                onUsernameChange={(username) => setEditingItem({ ...editingItem, passwordUsername: username })}
                                onPasswordChange={(password) => setEditingItem({ ...editingItem, passwordValue: password })}
                                onUrlChange={(url) => setEditingItem({ ...editingItem, passwordUrl: url })}
                                onNotesChange={(notes) => setEditingItem({ ...editingItem, passwordNotes: notes })}
                            />
                        )}
                    </CardContent>
                </Card>

                {/* 图片预览模态框 */}
                {previewImage && (
                    <div
                        className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-8"
                        onClick={() => setPreviewImage(null)}
                    >
                        <div className="relative max-w-4xl max-h-full">
                            <img
                                src={previewImage.src}
                                alt={previewImage.name}
                                className="max-w-full max-h-[80vh] object-contain rounded-lg"
                                onClick={e => e.stopPropagation()}
                            />
                            <div className="absolute top-4 right-4 flex gap-2">
                                <Button
                                    variant="secondary"
                                    size="icon"
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        const link = document.createElement('a')
                                        link.href = previewImage.src
                                        link.download = previewImage.name
                                        document.body.appendChild(link)
                                        link.click()
                                        document.body.removeChild(link)
                                    }}
                                >
                                    <Download className="w-5 h-5" />
                                </Button>
                                <Button
                                    variant="secondary"
                                    size="icon"
                                    onClick={() => setPreviewImage(null)}
                                >
                                    <X className="w-5 h-5" />
                                </Button>
                            </div>
                            <p className="text-center text-white mt-4">{previewImage.name}</p>
                        </div>
                    </div>
                )}
            </div>
        )
    }

    // 主界面 - 资产列表
    return (
        <div className="flex flex-col h-full">
            {/* Header - 固定 */}
            <div className="flex items-center justify-between shrink-0">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">保险箱</h1>
                    <p className="text-muted-foreground">安全存储您的敏感信息</p>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" onClick={() => handleAddItem('note')}>
                        <FileText className="w-4 h-4 mr-2" />
                        新建笔记
                    </Button>
                    <Button variant="outline" onClick={() => handleAddItem('document')}>
                        <Image className="w-4 h-4 mr-2" />
                        新建证件
                    </Button>
                    <Button variant="outline" onClick={() => handleAddItem('mfa')}>
                        <KeyRound className="w-4 h-4 mr-2" />
                        新建 MFA
                    </Button>
                    <Button variant="outline" onClick={() => handleAddItem('password')}>
                        <Lock className="w-4 h-4 mr-2" />
                        新建密码
                    </Button>
                    {activeTab === 'mfa' && vaultData.items.some(item => item.type === 'mfa' && item.mfaSecret) && (
                        <Button
                            variant="outline"
                            onClick={() => {
                                const mfaItems = vaultData.items.filter(item => item.type === 'mfa' && item.mfaSecret);
                                const lines = mfaItems.map(item => {
                                    const label = encodeURIComponent(item.title);
                                    const secret = item.mfaSecret ? item.mfaSecret.replace(/[\s-]/g, '').toUpperCase() : '';
                                    const issuer = item.mfaIssuer ? `&issuer=${encodeURIComponent(item.mfaIssuer)}` : '';
                                    return `otpauth://totp/${label}?secret=${secret}${issuer}`;
                                });
                                const content = lines.join('\n');
                                const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
                                const url = URL.createObjectURL(blob);
                                const link = document.createElement('a');
                                link.href = url;
                                link.download = 'mfa_export.txt';
                                document.body.appendChild(link);
                                link.click();
                                document.body.removeChild(link);
                                URL.revokeObjectURL(url);
                                alert(`成功导出 ${mfaItems.length} 个 MFA 账号密钥到 mfa_export.txt`);
                            }}
                        >
                            <Download className="w-4 h-4 mr-2" />
                            导出 MFA
                        </Button>
                    )}
                    <Button variant="ghost" onClick={handleLock}>
                        <Lock className="w-4 h-4" />
                    </Button>
                </div>
            </div>

            {/* 搜索和过滤 - 固定 */}
            <div className="flex items-center gap-4 mt-6 shrink-0">
                <div className="relative flex-1 max-w-md">
                    <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                        <Search className="h-4 w-4 text-muted-foreground" />
                    </span>
                    <Input
                        placeholder="搜索..."
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        className="pl-10"
                    />
                </div>
                <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
                    <TabsList>
                        <TabsTrigger value="all">全部</TabsTrigger>
                        <TabsTrigger value="password">密码</TabsTrigger>
                        <TabsTrigger value="document">证件</TabsTrigger>
                        <TabsTrigger value="note">笔记</TabsTrigger>
                        <TabsTrigger value="mfa">MFA</TabsTrigger>
                    </TabsList>
                </Tabs>
            </div>

            {/* 项目网格 - 可滚动 */}
            <div className="flex-1 overflow-auto mt-6 -mr-4 pr-4">
                {filteredItems.length === 0 ? (
                    <div className="text-center py-16 text-muted-foreground">
                        <Lock className="w-12 h-12 mx-auto mb-4 opacity-50" />
                        <p>还没有任何项目</p>
                        <p className="text-sm">点击上方按钮添加您的第一个项目</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pb-4">
                        {filteredItems.map(item => (
                            <Card
                                key={item.id}
                                className="cursor-pointer hover:shadow-md transition-shadow group"
                                onClick={() => setEditingItem(item)}
                            >
                                <CardHeader className="pb-2">
                                    <div className="flex items-start justify-between">
                                        <div className="flex items-center gap-2">
                                            {item.type === 'note' ? (
                                                <FileText className="w-5 h-5 text-blue-500" />
                                            ) : item.type === 'mfa' ? (
                                                <KeyRound className="w-5 h-5 text-amber-500" />
                                            ) : item.type === 'password' ? (
                                                <Lock className="w-5 h-5 text-purple-500" />
                                            ) : (
                                                <Image className="w-5 h-5 text-green-500" />
                                            )}
                                            <CardTitle className="text-lg line-clamp-1">{item.title}</CardTitle>
                                        </div>
                                        <Badge variant="secondary">
                                            {item.type === 'note' ? '笔记' :
                                                item.type === 'mfa' ? 'MFA' :
                                                    item.type === 'password' ? '密码' : '证件'}
                                        </Badge>
                                    </div>
                                </CardHeader>
                                <CardContent>
                                    {item.type === 'note' && item.content && (
                                        <div className="text-sm text-muted-foreground line-clamp-3 prose prose-sm dark:prose-invert max-w-none">
                                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                                {item.content.slice(0, 200)}
                                            </ReactMarkdown>
                                        </div>
                                    )}
                                    {item.type === 'document' && item.attachments && item.attachments.length > 0 && (
                                        <div className="flex gap-2">
                                            {item.attachments.slice(0, 2).map(att => (
                                                <img
                                                    key={att.id}
                                                    src={att.data}
                                                    alt={att.name}
                                                    className="w-16 h-16 object-cover rounded"
                                                />
                                            ))}
                                            {item.attachments.length > 2 && (
                                                <div className="w-16 h-16 rounded bg-muted flex items-center justify-center text-sm text-muted-foreground">
                                                    +{item.attachments.length - 2}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                    {item.type === 'mfa' && item.mfaSecret && (
                                        <MFACardPreview secret={item.mfaSecret} issuer={item.mfaIssuer} />
                                    )}
                                    {item.type === 'password' && (
                                        <PasswordCardPreview
                                            username={item.passwordUsername}
                                            password={item.passwordValue}
                                            url={item.passwordUrl}
                                            notes={item.passwordNotes}
                                        />
                                    )}
                                    <div className="flex items-center justify-between mt-3 pt-3 border-t">
                                        <span className="text-xs text-muted-foreground">
                                            {new Date(item.updatedAt).toLocaleDateString()}
                                        </span>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="opacity-0 group-hover:opacity-100 transition-opacity"
                                            onClick={(e) => { e.stopPropagation(); handleDeleteItem(item.id); }}
                                        >
                                            <Trash2 className="w-4 h-4 text-red-500" />
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}
