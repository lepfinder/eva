import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { AiProviderSettings } from '@/components/AiProviderSettings'
import { changeLanguage, getCurrentLanguage } from '@/i18n'
import { version as appVersion } from '../../package.json'
import {
  Check,
  FolderOpen,
  Keyboard,
  AlertCircle,
  RefreshCw,
  HardDrive,
  Loader2,
  MonitorPlay,
  BookOpen,
  Image,
  Globe,
  Clipboard,
  Lock,
  Activity,
  FileText,
  Wifi,
  Sparkles,
  Radio,
  Eye,
  EyeOff,
  Copy,
  Terminal,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  ExternalLink,
  LayoutDashboard,
  RotateCcw,
} from 'lucide-react'

// 存储统计类型
interface StorageStats {
  total: number
  totalFormatted?: string
  items: Array<{
    name: string
    path: string
    icon: string // key from userDataPath.ts
    size: number
    sizeFormatted?: string
  }>
}

const STORAGE_ICONS: Record<string, React.ReactNode> = {
  'visual_recall': <MonitorPlay className="h-4 w-4" />,
  'knowledge_base': <BookOpen className="h-4 w-4" />,
  'clipboard_images': <Image className="h-4 w-4" />,
  'navigation': <Globe className="h-4 w-4" />,
  'clipboard_history': <Clipboard className="h-4 w-4" />,
  'vault': <Lock className="h-4 w-4" />,
  'activity_tracker': <Activity className="h-4 w-4" />,
  'other': <FileText className="h-4 w-4" />
}

const STORAGE_COLORS: Record<string, string> = {
  'visual_recall': '#3b82f6', // blue
  'knowledge_base': '#10b981', // emerald
  'clipboard_images': '#f59e0b', // amber
  'navigation': '#06b6d4', // cyan
  'clipboard_history': '#8b5cf6', // purple
  'vault': '#ef4444', // red
  'activity_tracker': '#f97316', // orange
  'other': '#cbd5e1' // gray
}

export function SettingsPage(): React.ReactElement {
  const { t } = useTranslation()
  const currentLanguage = getCurrentLanguage()
  const [dataPath, setDataPath] = useState<string>('')
  const [storageStats, setStorageStats] = useState<StorageStats | null>(null)
  const [loadingStorage, setLoadingStorage] = useState(false)
  const [settings, setSettings] = useState<any>(null)
  const [activeTab, setActiveTab] = useState<'appearance' | 'security' | 'hotkeys' | 'network' | 'storage' | 'about' | 'ai' | 'api'>('appearance')

  // API 服务配置状态
  const [apiConfig, setApiConfig] = useState<{
    enabled: boolean
    port: number
    token: string
    requireAuth: boolean
    running: boolean
  }>({
    enabled: true,
    port: 14220,
    token: 'eva-local-token',
    requireAuth: true,
    running: false,
  })
  const [showToken, setShowToken] = useState(false)
  const [copiedToken, setCopiedToken] = useState(false)
  const [copiedBaseUrl, setCopiedBaseUrl] = useState(false)
  const [apiHealth, setApiHealth] = useState<{ ok: boolean; latencyMs: number } | null>(null)
  const [savingApiConfig, setSavingApiConfig] = useState(false)
  const [apiSaveSuccess, setApiSaveSuccess] = useState(false)
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle')
  const [testResult, setTestResult] = useState<string>('')
  const [activeCodeLang, setActiveCodeLang] = useState<'curl' | 'python' | 'ts'>('curl')

  useEffect(() => {
    window.api.httpServer.getConfig().then((cfg: any) => {
      if (cfg) setApiConfig({
        enabled: cfg.enabled ?? true,
        port: cfg.port ?? 14220,
        token: cfg.token ?? 'eva-local-token',
        requireAuth: cfg.requireAuth ?? true,
        running: cfg.running ?? false,
      })
    }).catch((e: any) => console.error('Failed to get API config:', e))
  }, [])

  // 探测 API 健康状态与延迟
  useEffect(() => {
    if (activeTab !== 'api' || !apiConfig.enabled) return
    let active = true
    const probe = async () => {
      const start = performance.now()
      try {
        const res = await fetch(`http://127.0.0.1:${apiConfig.port}/api/health`)
        if (res.ok && active) {
          const latency = Math.round(performance.now() - start)
          setApiHealth({ ok: true, latencyMs: latency })
        } else if (active) {
          setApiHealth(null)
        }
      } catch {
        if (active) setApiHealth(null)
      }
    }
    void probe()
    const timer = setInterval(probe, 4000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [activeTab, apiConfig.enabled, apiConfig.port])

  const handleSaveApiConfig = async () => {
    setSavingApiConfig(true)
    setApiSaveSuccess(false)
    try {
      const res = await window.api.httpServer.saveConfig(apiConfig)
      if (res) {
        setApiConfig(res)
        setApiSaveSuccess(true)
        setTimeout(() => setApiSaveSuccess(false), 3000)
      }
    } catch (err) {
      console.error('Failed to save API config:', err)
    } finally {
      setSavingApiConfig(false)
    }
  }

  const handleGenerateToken = async () => {
    try {
      const newToken = await window.api.httpServer.generateToken()
      if (newToken) {
        setApiConfig(prev => ({ ...prev, token: newToken }))
      }
    } catch (err) {
      console.error('Failed to generate token:', err)
    }
  }

  const handleCopyToken = () => {
    navigator.clipboard.writeText(apiConfig.token)
    setCopiedToken(true)
    setTimeout(() => setCopiedToken(false), 2000)
  }

  const handleTestApi = async () => {
    setTestStatus('testing')
    setTestResult('')
    try {
      const res = await window.api.httpServer.testConnection(apiConfig.port, apiConfig.token, apiConfig.requireAuth)
      if (res && res.success) {
        setTestStatus('success')
        setTestResult(`连接成功！${res.message}\n当前活跃聚焦应用: ${res.activeWindow || '无'}\n服务状态: 正常运行于 http://127.0.0.1:${apiConfig.port} (${apiConfig.requireAuth ? 'Token 鉴权模式' : '本机免 Token 模式'})`)
      } else if (res) {
        setTestStatus('error')
        setTestResult(res.message || '连接响应异常')
      } else {
        setTestStatus('error')
        setTestResult('未能收到测试响应，请确认 API 服务已开启')
      }
    } catch (err: any) {
      setTestStatus('error')
      setTestResult(`网络连接失败: ${err.message || err}`)
    }
  }

  useEffect(() => {
    // 获取数据目录路径
    window.api.getDataPath().then(setDataPath)
    // 加载全局设置
    window.api.settingsGetAll().then(setSettings)
  }, [])

  useEffect(() => {
    if (activeTab === 'storage' && !storageStats && !loadingStorage) {
      loadStorageStats()
    }
  }, [activeTab, storageStats, loadingStorage])

  const loadStorageStats = async () => {
    setLoadingStorage(true)
    try {
      const stats = await window.api.storageGetStats()
      setStorageStats(stats)
    } catch (e) {
      console.error('Failed to load storage stats:', e)
    } finally {
      setLoadingStorage(false)
    }
  }

  const handleLanguageChange = (lang: string): void => {
    changeLanguage(lang)
  }

  const handleSettingChange = async (key: string, value: any) => {
    const success = await window.api.settingsSet(key, value)
    if (success) {
      setSettings((prev: any) => ({ ...prev, [key]: value }))
    }
  }

  const handleOpenDataFolder = (): void => {
    if (dataPath) {
      window.api.openInFinder(dataPath)
    }
  }

  // ── 全局快捷键状态与配置 ──────────────────────────────────────
  interface HotkeyItem {
    id: string
    name: string
    description: string
    shortcut: string
    defaultShortcut: string
    enabled: boolean
  }

  const [hotkeyItems, setHotkeyItems] = useState<HotkeyItem[]>([
    {
      id: 'toggle_main',
      name: '唤起 / 隐藏 EVA 主窗口',
      description: '在任何外部软件下呼出或快速隐藏 EVA 工作台主窗口',
      shortcut: 'Alt+KeyE',
      defaultShortcut: 'Alt+KeyE',
      enabled: true
    },
    {
      id: 'hub_clipboard',
      name: '剪贴板历史浮窗 (HUB)',
      description: '弹出轻量剪贴板悬浮面板，支持方向键或 1~9 快捷选用写回',
      shortcut: 'Alt+KeyV',
      defaultShortcut: 'Alt+KeyV',
      enabled: true
    },
    {
      id: 'hub_command',
      name: '快捷命令与端口搜索 (HUB)',
      description: '弹出轻量快速面板，支持端口查询、一键 Kill 释放与即时速算',
      shortcut: 'Alt+KeyK',
      defaultShortcut: 'Alt+KeyK',
      enabled: true
    }
  ])
  const [editingHotkeyId, setEditingHotkeyId] = useState<string | null>(null)
  const [recordedKeys, setRecordedKeys] = useState<string[]>([])
  const [hotkeyMessage, setHotkeyMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [savingHotkeys, setSavingHotkeys] = useState(false)

  // 格式化展示按键名称
  const formatShortcutDisplay = (shortcut: string): string[] => {
    if (!shortcut || !shortcut.trim()) return ['未设置']
    return shortcut.split('+').map(part => {
      if (part === 'Alt') return '⌥'
      if (part === 'CommandOrControl' || part === 'Super' || part === 'Command') return '⌘'
      if (part === 'Shift') return '⇧'
      if (part === 'Control') return '⌃'
      if (part.startsWith('Key')) return part.slice(3).toUpperCase()
      if (part.startsWith('Digit')) return part.slice(5)
      return part
    })
  }

  // 加载快捷键
  const loadHotkeys = useCallback(async () => {
    try {
      if (window.api?.hotkeys?.getAll) {
        const res = await window.api.hotkeys.getAll()
        if (Array.isArray(res) && res.length > 0) {
          setHotkeyItems(res)
        }
      }
    } catch (e) {
      console.error('加载全局快捷键失败:', e)
    }
  }, [])

  useEffect(() => {
    loadHotkeys()
  }, [loadHotkeys])

  // 保存并即时生效快捷键配置
  const saveHotkeysList = async (newList: HotkeyItem[], successMsg = '快捷键配置已即时生效') => {
    setSavingHotkeys(true)
    try {
      if (window.api?.hotkeys?.saveAll) {
        const updated = await window.api.hotkeys.saveAll(newList)
        if (Array.isArray(updated)) {
          setHotkeyItems(updated)
        } else {
          setHotkeyItems(newList)
        }
      } else {
        setHotkeyItems(newList)
      }
      setHotkeyMessage({ text: successMsg, type: 'success' })
    } catch (err: any) {
      setHotkeyMessage({ text: `保存失败: ${err.message || err}`, type: 'error' })
    } finally {
      setSavingHotkeys(false)
      setTimeout(() => setHotkeyMessage(null), 3000)
    }
  }

  // 开关切换
  const handleToggleHotkey = async (id: string, enabled: boolean) => {
    const updated = hotkeyItems.map(item => item.id === id ? { ...item, enabled } : item)
    setHotkeyItems(updated)
    await saveHotkeysList(updated, enabled ? '已激活快捷键' : '已禁用该快捷键')
  }

  // 恢复默认快捷键
  const handleResetAllHotkeys = async () => {
    try {
      if (window.api?.hotkeys?.resetAll) {
        const res = await window.api.hotkeys.resetAll()
        setHotkeyItems(res)
      }
      setHotkeyMessage({ text: '已恢复默认快捷键配置', type: 'success' })
      setTimeout(() => setHotkeyMessage(null), 3000)
    } catch (e: any) {
      setHotkeyMessage({ text: `重置失败: ${e.message || e}`, type: 'error' })
    }
  }

  // 重置单项快捷键
  const handleResetSingleHotkey = async (id: string) => {
    const updated = hotkeyItems.map(item => {
      if (item.id === id) {
        return { ...item, shortcut: item.defaultShortcut, enabled: true }
      }
      return item
    })
    setHotkeyItems(updated)
    await saveHotkeysList(updated, '已恢复该项默认快捷键')
  }

  // 开始录制快捷键
  const startRecordingHotkey = (id: string) => {
    setEditingHotkeyId(id)
    setRecordedKeys([])
    setHotkeyMessage(null)
  }

  // 取消录制
  const cancelRecordingHotkey = () => {
    setEditingHotkeyId(null)
    setRecordedKeys([])
  }

  // 键盘录制事件处理
  const handleHotkeyKeyDown = async (e: React.KeyboardEvent) => {
    if (!editingHotkeyId) return

    e.preventDefault()
    e.stopPropagation()

    // 按 Escape 键取消录制
    if (e.key === 'Escape') {
      cancelRecordingHotkey()
      return
    }

    const modifiers: string[] = []
    if (e.altKey) modifiers.push('Alt')
    if (e.metaKey) modifiers.push('CommandOrControl')
    if (e.shiftKey) modifiers.push('Shift')
    if (e.ctrlKey && !e.metaKey) modifiers.push('Control')

    // 仅按下修饰键时更新实时显示
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) {
      setRecordedKeys(modifiers)
      return
    }

    // 至少需要一个修饰键
    if (modifiers.length === 0) {
      setHotkeyMessage({ text: '全局快捷键必须包含至少一个修饰键 (Option/Command/Shift/Control)', type: 'error' })
      return
    }

    // 使用物理 code 转换为合法按键名称 (例如 KeyE, KeyV, Digit1, Space 等)
    let mainKey = e.code
    if (!mainKey) {
      if (e.key.length === 1) {
        mainKey = `Key${e.key.toUpperCase()}`
      } else {
        mainKey = e.key
      }
    }

    const accelerator = [...modifiers, mainKey].join('+')
    setRecordedKeys([...modifiers, mainKey])

    // 更新到列表并保存
    const updated = hotkeyItems.map(item => {
      if (item.id === editingHotkeyId) {
        return { ...item, shortcut: accelerator, enabled: true }
      }
      return item
    })

    setEditingHotkeyId(null)
    setRecordedKeys([])
    await saveHotkeysList(updated, '快捷键已成功更新并即时生效')
  }

  const sidebarItems = [
    { id: 'appearance', label: t('settings.appearance.title'), icon: <MonitorPlay className="h-4 w-4" /> },
    { id: 'security', label: t('settings.security.title'), icon: <Lock className="h-4 w-4" /> },
    { id: 'ai', label: 'AI 供应商', icon: <Sparkles className="h-4 w-4" /> },
    { id: 'api', label: 'API 服务', icon: <Radio className="h-4 w-4" /> },
    { id: 'hotkeys', label: '全局快捷键', icon: <Keyboard className="h-4 w-4" /> },
    { id: 'network', label: '网络代理', icon: <Wifi className="h-4 w-4" /> },
    { id: 'storage', label: '存储管理', icon: <HardDrive className="h-4 w-4" /> },
    { id: 'about', label: t('settings.about.title'), icon: <FileText className="h-4 w-4" /> },
  ]

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b">
        <h1 className="text-2xl font-bold tracking-tight">{t('settings.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('settings.description')}</p>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div className="w-64 border-r p-4 space-y-2 overflow-y-auto">
          {sidebarItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id as any)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === item.id
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-3xl mx-auto space-y-6">
            {activeTab === 'appearance' && (
              <div className="space-y-6 animate-in fade-in duration-300">
                <Card>
                  <CardHeader>
                    <CardTitle>{t('settings.appearance.title')}</CardTitle>
                    <CardDescription>{t('settings.appearance.description')}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    {/* Language */}
                    <div className="space-y-2">
                      <label className="text-sm font-medium">{t('settings.appearance.language')}</label>
                      <div className="flex gap-2">
                        <Button
                          variant={currentLanguage === 'zh' ? 'default' : 'outline'}
                          className="flex-1 gap-2"
                          onClick={() => handleLanguageChange('zh')}
                        >
                          🇨🇳 中文
                          {currentLanguage === 'zh' && <Check className="ml-auto h-4 w-4" />}
                        </Button>
                        <Button
                          variant={currentLanguage === 'en' ? 'default' : 'outline'}
                          className="flex-1 gap-2"
                          onClick={() => handleLanguageChange('en')}
                        >
                          🇺🇸 English
                          {currentLanguage === 'en' && <Check className="ml-auto h-4 w-4" />}
                        </Button>
                      </div>
                    </div>

                    <Separator />

                    {/* Terminal Font */}
                    <div className="space-y-2">
                      <label className="text-sm font-medium">{t('settings.appearance.terminalFont')}</label>
                      <Select defaultValue="JetBrains Mono">
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="JetBrains Mono">JetBrains Mono</SelectItem>
                          <SelectItem value="Fira Code">Fira Code</SelectItem>
                          <SelectItem value="SF Mono">SF Mono</SelectItem>
                          <SelectItem value="Monaco">Monaco</SelectItem>
                          <SelectItem value="Consolas">Consolas</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-medium">{t('settings.appearance.terminalFontSize')}</label>
                      <input
                        type="number"
                        className="flex h-10 w-32 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        defaultValue={14}
                        min={10}
                        max={24}
                      />
                    </div>

                    <Separator />

                    {/* Virtual Avatar */}
                    <div className="flex items-center justify-between">
                      <div className="space-y-1">
                        <label className="text-sm font-medium">{t('settings.appearance.enableVirtualAvatar')}</label>
                        <p className="text-xs text-muted-foreground">{t('settings.appearance.enableVirtualAvatarDesc')}</p>
                      </div>
                      <Switch
                        checked={settings?.enableVirtualAvatar !== false}
                        onCheckedChange={(checked) => handleSettingChange('enableVirtualAvatar', checked)}
                      />
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {activeTab === 'ai' && <AiProviderSettings />}

            {activeTab === 'security' && (
              <div className="space-y-6 animate-in fade-in duration-300">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Lock className="h-5 w-5" />
                      {t('settings.security.title')}
                    </CardTitle>
                    <CardDescription>{t('settings.security.description')}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="space-y-1">
                          <label className="text-sm font-medium">{t('settings.security.vaultAutoLock')}</label>
                          <p className="text-xs text-muted-foreground">{t('settings.security.vaultAutoLockDesc')}</p>
                        </div>
                        <div className="flex items-center gap-3">
                          <Select
                            value={String(settings?.vaultAutoLockMinutes || 5)}
                            onValueChange={(v) => handleSettingChange('vaultAutoLockMinutes', parseInt(v))}
                          >
                            <SelectTrigger className="w-40">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="1">1 {t('settings.security.unitMinute')}</SelectItem>
                              <SelectItem value="5">5 {t('settings.security.unitMinute')}</SelectItem>
                              <SelectItem value="10">10 {t('settings.security.unitMinute')}</SelectItem>
                              <SelectItem value="30">30 {t('settings.security.unitMinute')}</SelectItem>
                              <SelectItem value="60">1 {t('settings.security.unitHour')}</SelectItem>
                              <SelectItem value="120">2 {t('settings.security.unitHour')}</SelectItem>
                              <SelectItem value="240">4 {t('settings.security.unitHour')}</SelectItem>
                              <SelectItem value="480">8 {t('settings.security.unitHour')}</SelectItem>
                              <SelectItem value="720">12 {t('settings.security.unitHour')}</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {t('settings.security.vaultAutoLockNote')}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {activeTab === 'hotkeys' && (
              <div className="space-y-6 animate-in fade-in duration-300">
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="flex items-center gap-2">
                          <Keyboard className="h-5 w-5" />
                          全局快捷键
                        </CardTitle>
                        <CardDescription>
                          在系统任何应用中快速呼出 EVA 功能。所有设置修改后立即动态生效，无需重启应用。
                        </CardDescription>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleResetAllHotkeys}
                        disabled={savingHotkeys}
                        className="text-xs"
                      >
                        <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                        恢复默认快捷键
                      </Button>
                    </div>
                  </CardHeader>

                  <CardContent className="space-y-4">
                    {/* 状态操作通知浮条 */}
                    {hotkeyMessage && (
                      <div className={`flex items-center justify-between p-3 rounded-lg text-xs font-medium animate-in fade-in duration-150 ${
                        hotkeyMessage.type === 'success'
                          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                          : 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20'
                      }`}>
                        <div className="flex items-center gap-2">
                          {hotkeyMessage.type === 'success' ? (
                            <CheckCircle2 className="h-4 w-4 shrink-0" />
                          ) : (
                            <AlertCircle className="h-4 w-4 shrink-0" />
                          )}
                          <span>{hotkeyMessage.text}</span>
                        </div>
                        <button
                          onClick={() => setHotkeyMessage(null)}
                          className="text-muted-foreground hover:text-foreground text-xs ml-2 cursor-pointer"
                        >
                          ✕
                        </button>
                      </div>
                    )}

                    {/* 快捷键配置列表 */}
                    <div className="space-y-3">
                      {hotkeyItems.map((item) => {
                        const isEditing = editingHotkeyId === item.id
                        const isCustom = item.shortcut !== item.defaultShortcut

                        return (
                          <div
                            key={item.id}
                            className={`p-4 rounded-xl border transition-all duration-200 ${
                              isEditing
                                ? 'border-purple-500/60 bg-purple-500/5 shadow-xs ring-1 ring-purple-500/30'
                                : item.enabled
                                  ? 'border-border/60 bg-card/60 hover:border-border hover:bg-muted/30'
                                  : 'border-border/30 bg-muted/20 opacity-70'
                            }`}
                          >
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                              {/* 左侧：图标与说明 */}
                              <div className="flex items-start gap-3.5 min-w-0 flex-1">
                                <div className={`p-2.5 rounded-xl shrink-0 mt-0.5 ${
                                  item.id === 'toggle_main'
                                    ? 'bg-blue-500/10 text-blue-500'
                                    : item.id === 'hub_clipboard'
                                      ? 'bg-amber-500/10 text-amber-500'
                                      : 'bg-violet-500/10 text-violet-500'
                                }`}>
                                  {item.id === 'toggle_main' ? (
                                    <LayoutDashboard className="h-5 w-5" />
                                  ) : item.id === 'hub_clipboard' ? (
                                    <Clipboard className="h-5 w-5" />
                                  ) : (
                                    <Terminal className="h-5 w-5" />
                                  )}
                                </div>

                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-semibold text-sm text-foreground">
                                      {item.name}
                                    </span>
                                    {isCustom && (
                                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono">
                                        默认: {formatShortcutDisplay(item.defaultShortcut).join(' ')}
                                      </span>
                                    )}
                                    {!item.enabled && (
                                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                                        已停用
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-xs text-muted-foreground mt-1">
                                    {item.description}
                                  </p>
                                </div>
                              </div>

                              {/* 右侧：按键录制、恢复默认与开关 */}
                              <div className="flex items-center gap-3 shrink-0 self-end sm:self-center">
                                {isEditing ? (
                                  <div className="flex items-center gap-2">
                                    <div
                                      tabIndex={0}
                                      onKeyDown={handleHotkeyKeyDown}
                                      autoFocus
                                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-500/10 border-2 border-purple-500 text-xs font-mono min-w-[170px] justify-center text-purple-600 dark:text-purple-300 font-semibold shadow-inner focus:outline-none animate-pulse"
                                    >
                                      {recordedKeys.length > 0
                                        ? formatShortcutDisplay(recordedKeys.join('+')).join(' + ')
                                        : '按下新的按键组合...'}
                                    </div>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={cancelRecordingHotkey}
                                      className="text-xs h-8"
                                    >
                                      取消
                                    </Button>
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-2.5">
                                    {/* 键帽立体展示 */}
                                    <div className={`flex items-center gap-1.5 ${item.enabled ? '' : 'opacity-40 grayscale'}`}>
                                      {formatShortcutDisplay(item.shortcut).map((key, i) => (
                                        <kbd
                                          key={i}
                                          className="px-2.5 py-1 text-xs font-mono font-semibold rounded-md border border-border/80 bg-muted/80 shadow-xs text-foreground min-w-[28px] text-center"
                                        >
                                          {key}
                                        </kbd>
                                      ))}
                                    </div>

                                    {/* 修改按钮 */}
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => startRecordingHotkey(item.id)}
                                      disabled={!item.enabled || savingHotkeys}
                                      className="text-xs h-8 px-2.5"
                                      title="更改此快捷键"
                                    >
                                      更改
                                    </Button>

                                    {/* 恢复该项默认按钮 */}
                                    {isCustom && (
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => handleResetSingleHotkey(item.id)}
                                        disabled={savingHotkeys}
                                        className="text-xs h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                                        title="复原此项为默认快捷键"
                                      >
                                        <RotateCcw className="h-3.5 w-3.5" />
                                      </Button>
                                    )}

                                    <div className="h-4 w-px bg-border/80 mx-0.5" />

                                    {/* 启用/禁用 开关 */}
                                    <div className="flex items-center gap-1.5" title={item.enabled ? '点击禁用该快捷键' : '点击激活该快捷键'}>
                                      <Switch
                                        checked={item.enabled}
                                        onCheckedChange={(checked) => handleToggleHotkey(item.id, checked)}
                                        disabled={savingHotkeys}
                                      />
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>

                    <div className="mt-4 pt-3 border-t border-border/40 flex items-center justify-between text-xs text-muted-foreground">
                      <p>
                        💡 提示：按住 <kbd className="px-1.5 py-0.5 rounded bg-muted font-mono">⌥ Option</kbd>、<kbd className="px-1.5 py-0.5 rounded bg-muted font-mono">⌘ Command</kbd> 或 <kbd className="px-1.5 py-0.5 rounded bg-muted font-mono">⇧ Shift</kbd> 再按目标字母即可完成录制。若产生快捷键冲突，可随时关闭对应开关停用。
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {activeTab === 'storage' && (
              <div className="space-y-6 animate-in fade-in duration-300">
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="flex items-center gap-2">
                          <HardDrive className="h-5 w-5" />
                          存储管理
                        </CardTitle>
                        <CardDescription>查看各类数据的磁盘占用情况</CardDescription>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={loadStorageStats}
                          disabled={loadingStorage}
                          title="刷新"
                        >
                          {loadingStorage ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <RefreshCw className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {storageStats ? (
                      <>
                        {/* 总占用 & Macintosh HD 风格 */}
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-muted-foreground">EVA Data</span>
                          <span className="text-sm text-foreground font-medium">已使用 {storageStats.totalFormatted}</span>
                        </div>

                        {/* 条形图 */}
                        <div className="h-8 w-full bg-muted/30 rounded-lg overflow-hidden flex relative border box-content">
                          {storageStats.items.map((item) => {
                            const percentage = storageStats.total > 0 ? (item.size / storageStats.total) * 100 : 0
                            if (percentage < 0.5) return null
                            const color = STORAGE_COLORS[item.icon] || STORAGE_COLORS.other

                            return (
                              <div
                                key={item.path}
                                className="h-full border-r border-white/20 last:border-0 hover:brightness-110 transition-all cursor-default"
                                style={{ width: `${percentage}%`, backgroundColor: color }}
                                title={`${item.name}: ${item.sizeFormatted}`}
                              />
                            )
                          })}
                        </div>

                        {/* 图例 */}
                        <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground pt-1">
                          {storageStats.items.map((item) => {
                            if ((storageStats.total > 0 ? (item.size / storageStats.total) * 100 : 0) < 1) return null // Hide legend for tiny items
                            const color = STORAGE_COLORS[item.icon] || STORAGE_COLORS.other
                            return (
                              <div key={item.name} className="flex items-center gap-1.5">
                                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
                                <span>{item.name}</span>
                              </div>
                            )
                          })}
                        </div>

                        <div className="flex justify-end pt-2">
                          <Dialog>
                            <DialogTrigger asChild>
                              <Button variant="outline" size="sm">管理...</Button>
                            </DialogTrigger>
                            <DialogContent className="max-w-2xl">
                              <DialogHeader>
                                <DialogTitle>存储详情</DialogTitle>
                              </DialogHeader>
                              <div className="space-y-4 mt-4 max-h-[60vh] overflow-y-auto pr-2">
                                <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50 text-xs text-muted-foreground overflow-hidden">
                                  <FolderOpen className="h-4 w-4 shrink-0" />
                                  <span className="truncate flex-1" title={dataPath}>{dataPath}</span>
                                  <Button variant="link" size="sm" className="h-auto p-0" onClick={handleOpenDataFolder}>
                                    打开目录
                                  </Button>
                                </div>

                                <div className="space-y-3">
                                  {storageStats.items.map((item) => {
                                    const percentage = storageStats.total > 0 ? (item.size / storageStats.total) * 100 : 0
                                    const icon = STORAGE_ICONS[item.icon] || STORAGE_ICONS.other
                                    const color = STORAGE_COLORS[item.icon] || STORAGE_COLORS.other

                                    return (
                                      <div key={item.path} className="space-y-1.5">
                                        <div className="flex items-center justify-between text-sm">
                                          <div className="flex items-center gap-2">
                                            <div className="text-zinc-500">{icon}</div>
                                            <span className="font-medium">{item.name}</span>
                                          </div>
                                          <span className="font-mono text-zinc-500">{item.sizeFormatted}</span>
                                        </div>
                                        <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                                          <div
                                            className="h-full rounded-full"
                                            style={{ width: `${percentage}%`, backgroundColor: color }}
                                          />
                                        </div>
                                      </div>
                                    )
                                  })}
                                </div>
                              </div>
                            </DialogContent>
                          </Dialog>
                        </div>
                      </>
                    ) : (
                      <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                        {loadingStorage ? (
                          <>
                            <Loader2 className="h-6 w-6 animate-spin mb-2" />
                            <p>正在计算存储占用...</p>
                          </>
                        ) : (
                          <>
                            <HardDrive className="h-8 w-8 mb-2 opacity-50" />
                            <p>点击刷新查看存储占用</p>
                          </>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}

            {activeTab === 'network' && (
              <div className="space-y-6 animate-in fade-in duration-300">
                <Card>
                  <CardHeader>
                    <CardTitle>网络代理</CardTitle>
                    <CardDescription>
                      配置应用内网络请求走哪种代理，影响站点图标下载、站点信息获取等功能。
                      默认跟随系统代理，Clash 等工具的「系统代理」开关可直接生效。
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    {/* 三档模式选择 */}
                    <div className="space-y-3">
                      <label className="text-sm font-medium">代理模式</label>
                      <div className="flex gap-2">
                        <Button
                          variant={(settings?.proxyMode ?? 'system') === 'system' ? 'default' : 'outline'}
                          className="flex-1"
                          onClick={() => handleSettingChange('proxyMode', 'system')}
                        >
                          系统代理
                        </Button>
                        <Button
                          variant={settings?.proxyMode === 'custom' ? 'default' : 'outline'}
                          className="flex-1"
                          onClick={() => handleSettingChange('proxyMode', 'custom')}
                        >
                          自定义
                        </Button>
                        <Button
                          variant={settings?.proxyMode === 'direct' ? 'default' : 'outline'}
                          className="flex-1"
                          onClick={() => handleSettingChange('proxyMode', 'direct')}
                        >
                          直连
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {settings?.proxyMode === 'custom' && '使用下方手动填写的代理地址，立即生效'}
                        {settings?.proxyMode === 'direct' && '强制直连，忽略系统代理（不推荐，国外站点可能无法访问）'}
                        {(!settings?.proxyMode || settings.proxyMode === 'system') && '跟随系统代理，Clash/Charles 等工具的「系统代理」开关自动生效（推荐）'}
                      </p>
                    </div>

                    {settings?.proxyMode === 'custom' && (
                      <>
                        <Separator />

                        {/* 代理地址 */}
                        <div className="space-y-2">
                          <label className="text-sm font-medium">代理地址</label>
                          <Input
                            value={settings?.proxyUrl ?? ''}
                            onChange={(e) => setSettings((prev: any) => ({ ...prev, proxyUrl: e.target.value }))}
                            onBlur={(e) => handleSettingChange('proxyUrl', e.target.value)}
                            placeholder="http://127.0.0.1:7897 或 socks5://127.0.0.1:1080"
                          />
                          <p className="text-xs text-muted-foreground">
                            支持 http://、https://、socks5:// 协议。修改后失焦自动生效。
                          </p>
                        </div>

                        {/* 不走代理的地址 */}
                        <div className="space-y-2">
                          <label className="text-sm font-medium">不走代理的地址</label>
                          <Input
                            value={settings?.proxyBypass ?? '<local>'}
                            onChange={(e) => setSettings((prev: any) => ({ ...prev, proxyBypass: e.target.value }))}
                            onBlur={(e) => handleSettingChange('proxyBypass', e.target.value)}
                            placeholder="<local>,*.example.com"
                          />
                          <p className="text-xs text-muted-foreground">
                            逗号分隔。<code className="text-xs bg-muted px-1 rounded">&lt;local&gt;</code> 表示所有本地地址不走代理。
                          </p>
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}

            {activeTab === 'api' && (
              <div className="space-y-6 animate-in fade-in duration-300">
                {/* 标题说明 */}
                <div>
                  <h3 className="text-base font-bold flex items-center gap-2">
                    <Radio className="h-5 w-5 text-primary" />
                    REST API 服务 (API Service)
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    EVA 嵌入式后台 HTTP 服务已启动，可用于外部脚本、Raycast 及第三方工具调用。
                  </p>
                </div>

                {/* 核心服务状态与在线文档主入口卡片 (AgentDeck 风格) */}
                <div className="rounded-2xl border bg-card p-6 space-y-6 shadow-xs">
                  {/* 状态与 Base URL 栏 */}
                  <div className="flex items-center justify-between flex-wrap gap-4">
                    <div className="space-y-1.5">
                      <div className="text-xs font-semibold text-muted-foreground">服务监听地址 (Base URL)</div>
                      <div className="flex items-center gap-2">
                        <div className="px-3.5 py-2 rounded-xl bg-muted/70 border font-mono text-sm text-blue-500 dark:text-blue-400 font-bold select-all">
                          http://127.0.0.1:{apiConfig.port}
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            navigator.clipboard.writeText(`http://127.0.0.1:${apiConfig.port}`)
                            setCopiedBaseUrl(true)
                            setTimeout(() => setCopiedBaseUrl(false), 2000)
                          }}
                          className="h-9 px-3 text-xs gap-1.5 rounded-xl cursor-pointer"
                          title="复制 Base URL"
                        >
                          {copiedBaseUrl ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                          <span>{copiedBaseUrl ? '已复制' : '复制'}</span>
                        </Button>
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-1.5">
                      <div className="text-xs font-semibold text-muted-foreground">服务状态</div>
                      <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold border ${
                        apiConfig.enabled && apiHealth?.ok
                          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                          : apiConfig.enabled
                          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                          : 'bg-muted text-muted-foreground border-border'
                      }`}>
                        {apiConfig.enabled && (
                          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                        )}
                        <span>
                          {apiConfig.enabled
                            ? (apiHealth?.ok ? '服务运行中 (Active)' : '服务已就绪 (Active)')
                            : '服务已停用 (Disabled)'}
                        </span>
                        {apiHealth && (
                          <span className="text-[11px] font-mono opacity-80">
                            ({apiHealth.latencyMs}ms)
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* 鉴权说明 Banner */}
                  {!apiConfig.requireAuth ? (
                    <div className="border border-blue-500/20 bg-blue-500/5 rounded-xl p-4 flex items-start gap-3">
                      <div className="p-1.5 rounded-lg bg-blue-500/20 text-blue-500 dark:text-blue-400 mt-0.5 shrink-0">
                        <Lock className="h-4 w-4" />
                      </div>
                      <div className="text-xs space-y-1">
                        <div className="font-bold text-blue-500 dark:text-blue-400">免 Token 鉴权 (No Token Required)</div>
                        <p className="text-muted-foreground text-xs leading-relaxed">
                          当前服务默认严格限制在本机回环网卡（<code className="font-mono text-blue-400">127.0.0.1:{apiConfig.port}</code>），外部网络无法直连，保证本机数据安全的同时方便脚本直接免签调用。
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="border border-amber-500/20 bg-amber-500/5 rounded-xl p-4 flex items-start gap-3">
                      <div className="p-1.5 rounded-lg bg-amber-500/20 text-amber-500 dark:text-amber-400 mt-0.5 shrink-0">
                        <Lock className="h-4 w-4" />
                      </div>
                      <div className="text-xs space-y-1">
                        <div className="font-bold text-amber-500 dark:text-amber-400">Token 身份校验保护 (Bearer Token Required)</div>
                        <p className="text-muted-foreground text-xs leading-relaxed">
                          已启用鉴权保护，外部 Agent 请求时必须携带 <code className="font-mono text-amber-400">Authorization: Bearer &lt;token&gt;</code> 请求头。
                        </p>
                      </div>
                    </div>
                  )}

                  {/* 核心主入口按钮：打开精美在线交互式文档 */}
                  <Button
                    onClick={() => window.api.openInBrowser(`http://127.0.0.1:${apiConfig.port}/docs`)}
                    className="w-full py-6 bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm rounded-xl transition-all duration-150 cursor-pointer shadow-md flex items-center justify-center gap-2"
                  >
                    <span>查看 API 文档</span>
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                </div>

                {/* 服务配置卡片 */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <ShieldCheck className="h-4 w-4 text-primary" />
                      服务与鉴权配置 (Configuration)
                    </CardTitle>
                    <CardDescription>
                      配置 HTTP 监听端口、鉴权策略及访问凭证
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    {/* 服务开关 */}
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <label className="text-sm font-medium">启用本地 API 服务</label>
                        <p className="text-xs text-muted-foreground">
                          开启后，EVA 将在后台监听本地回环端口并处理外部 Agent 请求
                        </p>
                      </div>
                      <Switch
                        checked={apiConfig.enabled}
                        onCheckedChange={(checked) => setApiConfig((prev) => ({ ...prev, enabled: checked }))}
                      />
                    </div>

                    <Separator />

                    {/* Token 鉴权开关 */}
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <label className="text-sm font-medium">开启 Token 身份校验</label>
                          {!apiConfig.requireAuth && (
                            <span className="text-[10px] font-medium bg-blue-500/15 text-blue-600 dark:text-blue-400 px-2 py-0.5 rounded-full border border-blue-500/30">
                              本机免 Token 模式
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {apiConfig.requireAuth
                            ? '已启用保护：外部 Agent 必须在 HTTP 请求头中携带 Authorization: Bearer <token>'
                            : '已开启免密：本机 Agent 或脚本访问 http://127.0.0.1 时无需携带 Authorization Token，极简接入'}
                        </p>
                      </div>
                      <Switch
                        checked={apiConfig.requireAuth}
                        onCheckedChange={(checked) => setApiConfig((prev) => ({ ...prev, requireAuth: checked }))}
                      />
                    </div>

                    <Separator />

                    {/* 监听端口 */}
                    <div className="space-y-2">
                      <label className="text-sm font-medium">监听端口 (Port)</label>
                      <Input
                        type="number"
                        value={apiConfig.port}
                        onChange={(e) =>
                          setApiConfig((prev) => ({ ...prev, port: parseInt(e.target.value) || 14220 }))
                        }
                        placeholder="14220"
                        className="max-w-xs"
                      />
                      <p className="text-xs text-muted-foreground">
                        默认端口 14220。EVA 严格绑定至 <code className="text-xs bg-muted px-1 rounded">127.0.0.1</code> 本地回环地址，拒绝外网及局域网未经授权请求。
                      </p>
                    </div>

                    <Separator />

                    {/* 鉴权 Token */}
                    <div className={`space-y-2 transition-opacity ${apiConfig.requireAuth ? 'opacity-100' : 'opacity-70'}`}>
                      <label className="text-sm font-medium flex items-center justify-between">
                        <span className="flex items-center gap-2">
                          <span>访问凭证 (Bearer Token)</span>
                          {!apiConfig.requireAuth && <span className="text-xs text-muted-foreground">（当前处于免校验模式，可备用）</span>}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs gap-1"
                          onClick={handleGenerateToken}
                        >
                          <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                          随机生成新 Token
                        </Button>
                      </label>
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <Input
                            type={showToken ? 'text' : 'password'}
                            value={apiConfig.token}
                            onChange={(e) => setApiConfig((prev) => ({ ...prev, token: e.target.value }))}
                            placeholder="例如 eva-local-token"
                            className="pr-10 font-mono text-sm"
                          />
                          <button
                            type="button"
                            onClick={() => setShowToken(!showToken)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                          >
                            {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          className="gap-1.5 cursor-pointer"
                          onClick={handleCopyToken}
                        >
                          {copiedToken ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                          {copiedToken ? '已复制' : '复制'}
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {apiConfig.requireAuth ? (
                          <>外部调用时必须在 HTTP 请求头添加 <code className="text-xs bg-muted px-1 rounded">Authorization: Bearer {apiConfig.token || '<token>'}</code>。</>
                        ) : (
                          <>当前已开启免 Token 访问，外部调用时可省略 Authorization 请求头。</>
                        )}
                      </p>
                    </div>

                    <div className="flex items-center gap-3 pt-2">
                      <Button
                        onClick={handleSaveApiConfig}
                        disabled={savingApiConfig}
                        className="gap-2 cursor-pointer"
                      >
                        {savingApiConfig ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                        保存并应用配置
                      </Button>
                      {apiSaveSuccess && (
                        <span className="text-sm text-emerald-600 dark:text-emerald-400 flex items-center gap-1 animate-in fade-in">
                          <CheckCircle2 className="h-4 w-4" /> 配置已保存并即时生效
                        </span>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* 联调测试与代码示例 */}
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-base flex items-center gap-2">
                          <Terminal className="h-4 w-4" />
                          Agent 接入与快速调用示例
                        </CardTitle>
                        <CardDescription>
                          测试本地 HTTP 服务连接或直接复制对应语言的调用示例
                        </CardDescription>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleTestApi}
                        disabled={testStatus === 'testing' || !apiConfig.enabled}
                        className="gap-1.5 cursor-pointer"
                      >
                        {testStatus === 'testing' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                        测试本地 API 连通性
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {testStatus !== 'idle' && (
                      <div
                        className={`p-3 rounded-lg text-xs font-mono whitespace-pre-wrap border ${
                          testStatus === 'success'
                            ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20'
                            : testStatus === 'error'
                            ? 'bg-destructive/10 text-destructive border-destructive/20'
                            : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {testResult || '正在发送测试请求...'}
                      </div>
                    )}

                    {/* 代码选项卡 */}
                    <div className="space-y-2">
                      <div className="flex gap-2 border-b pb-2">
                        <button
                          onClick={() => setActiveCodeLang('curl')}
                          className={`text-xs px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                            activeCodeLang === 'curl'
                              ? 'bg-primary text-primary-foreground'
                              : 'text-muted-foreground hover:text-foreground'
                          }`}
                        >
                          cURL
                        </button>
                        <button
                          onClick={() => setActiveCodeLang('python')}
                          className={`text-xs px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                            activeCodeLang === 'python'
                              ? 'bg-primary text-primary-foreground'
                              : 'text-muted-foreground hover:text-foreground'
                          }`}
                        >
                          Python (requests)
                        </button>
                        <button
                          onClick={() => setActiveCodeLang('ts')}
                          className={`text-xs px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                            activeCodeLang === 'ts'
                              ? 'bg-primary text-primary-foreground'
                              : 'text-muted-foreground hover:text-foreground'
                          }`}
                        >
                          TypeScript / Node
                        </button>
                      </div>

                      <div className="relative">
                        <pre className="p-3 bg-muted/70 rounded-lg text-xs font-mono overflow-x-auto text-foreground">
                          {activeCodeLang === 'curl' && (apiConfig.requireAuth
                            ? `curl -H "Authorization: Bearer ${apiConfig.token}" \\\n  http://127.0.0.1:${apiConfig.port}/api/context`
                            : `curl http://127.0.0.1:${apiConfig.port}/api/context`)}
                          {activeCodeLang === 'python' && (apiConfig.requireAuth
                            ? `import requests\n\nurl = "http://127.0.0.1:${apiConfig.port}/api/context"\nheaders = {"Authorization": "Bearer ${apiConfig.token}"}\n\nresponse = requests.get(url, headers=headers)\ncontext_data = response.json()\nprint("当前活跃应用:", context_data.get("activeWindow"))`
                            : `import requests\n\nurl = "http://127.0.0.1:${apiConfig.port}/api/context"\nresponse = requests.get(url)\ncontext_data = response.json()\nprint("当前活跃应用:", context_data.get("activeWindow"))`)}
                          {activeCodeLang === 'ts' && (apiConfig.requireAuth
                            ? `const res = await fetch("http://127.0.0.1:${apiConfig.port}/api/context", {\n  headers: {\n    Authorization: "Bearer ${apiConfig.token}",\n  },\n});\nconst data = await res.json();\nconsole.log("当前活跃应用:", data.activeWindow);`
                            : `const res = await fetch("http://127.0.0.1:${apiConfig.port}/api/context");\nconst data = await res.json();\nconsole.log("当前活跃应用:", data.activeWindow);`)}
                        </pre>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="absolute right-2 top-2 h-7 px-2 text-xs cursor-pointer"
                          onClick={() => {
                            let code = ''
                            if (activeCodeLang === 'curl') {
                              code = apiConfig.requireAuth
                                ? `curl -H "Authorization: Bearer ${apiConfig.token}" http://127.0.0.1:${apiConfig.port}/api/context`
                                : `curl http://127.0.0.1:${apiConfig.port}/api/context`
                            } else if (activeCodeLang === 'python') {
                              code = apiConfig.requireAuth
                                ? `import requests\n\nres = requests.get("http://127.0.0.1:${apiConfig.port}/api/context", headers={"Authorization": "Bearer ${apiConfig.token}"})\nprint(res.json())`
                                : `import requests\n\nres = requests.get("http://127.0.0.1:${apiConfig.port}/api/context")\nprint(res.json())`
                            } else {
                              code = apiConfig.requireAuth
                                ? `const res = await fetch("http://127.0.0.1:${apiConfig.port}/api/context", { headers: { Authorization: "Bearer ${apiConfig.token}" } });\nconsole.log(await res.json());`
                                : `const res = await fetch("http://127.0.0.1:${apiConfig.port}/api/context");\nconsole.log(await res.json());`
                            }
                            navigator.clipboard.writeText(code)
                          }}
                        >
                          <Copy className="h-3.5 w-3.5 mr-1" /> 复制示例
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {activeTab === 'about' && (
              <div className="space-y-6 animate-in fade-in duration-300">
                <Card>
                  <CardHeader>
                    <CardTitle>{t('settings.about.title')}</CardTitle>
                    <CardDescription>{t('settings.about.description')}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t('settings.about.version')}</span>
                      <span>v{appVersion}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Electron</span>
                      <span>33.x</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">React</span>
                      <span>18.x</span>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
