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
    running: boolean
  }>({
    enabled: true,
    port: 14220,
    token: 'eva-local-token',
    running: false,
  })
  const [showToken, setShowToken] = useState(false)
  const [copiedToken, setCopiedToken] = useState(false)
  const [savingApiConfig, setSavingApiConfig] = useState(false)
  const [apiSaveSuccess, setApiSaveSuccess] = useState(false)
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle')
  const [testResult, setTestResult] = useState<string>('')
  const [activeCodeLang, setActiveCodeLang] = useState<'curl' | 'python' | 'ts'>('curl')

  useEffect(() => {
    window.api.httpServer.getConfig().then((cfg: any) => {
      if (cfg) setApiConfig(cfg)
    }).catch((e: any) => console.error('Failed to get API config:', e))
  }, [])

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
      const res = await window.api.httpServer.testConnection(apiConfig.port, apiConfig.token)
      if (res && res.success) {
        setTestStatus('success')
        setTestResult(`连接成功！${res.message}\n当前活跃聚焦应用: ${res.activeWindow || '无'}\n服务状态: 正常运行于 http://127.0.0.1:${apiConfig.port}`)
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

  // 快捷键配置
  const [hotkeys, setHotkeys] = useState<Record<string, string>>({})
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [recordingKeys, setRecordingKeys] = useState<string[]>([])
  const [hotkeyError, setHotkeyError] = useState<string | null>(null)

  // 快捷键名称映射
  const hotkeyLabels: Record<string, string> = {
    moduleVault: '跳转保险箱',
    moduleTimeAuditor: '跳转时间审计',
    timeMark: '快速时间标记'
  }

  // 加载配置
  useEffect(() => {
    window.api.hotkeys.getAll().then(setHotkeys)
  }, [])

  // 开始录制快捷键
  const startRecording = useCallback((key: string) => {
    setEditingKey(key)
    setRecordingKeys([])
    setHotkeyError(null)
  }, [])

  // 处理键盘事件
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!editingKey) return

    e.preventDefault()
    e.stopPropagation()

    const modifiers: string[] = []
    if (e.metaKey) modifiers.push('CommandOrControl')
    if (e.ctrlKey && !e.metaKey) modifiers.push('Control')
    if (e.altKey) modifiers.push('Alt')
    if (e.shiftKey) modifiers.push('Shift')

    // 获取按键名称
    let key = e.key
    if (key === 'Control' || key === 'Alt' || key === 'Shift' || key === 'Meta') {
      setRecordingKeys(modifiers)
      return
    }

    // 格式化特殊按键
    if (key === ' ') key = 'Space'
    else if (key === 'ArrowUp') key = 'Up'
    else if (key === 'ArrowDown') key = 'Down'
    else if (key === 'ArrowLeft') key = 'Left'
    else if (key === 'ArrowRight') key = 'Right'
    else if (key.length === 1) key = key.toUpperCase()

    const accelerator = [...modifiers, key].join('+')
    setRecordingKeys([...modifiers, key])

    // 保存快捷键
    window.api.hotkeys.set(editingKey, accelerator).then(() => {
      setHotkeys(prev => ({ ...prev, [editingKey]: accelerator }))
      setEditingKey(null)
      setRecordingKeys([])
    }).catch((err: any) => {
      setHotkeyError(`保存失败: ${err.message}`)
    })
  }, [editingKey])

  // 取消录制
  const cancelRecording = useCallback(() => {
    setEditingKey(null)
    setRecordingKeys([])
    setHotkeyError(null)
  }, [])

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
                    <CardTitle className="flex items-center gap-2">
                      <Keyboard className="h-5 w-5" />
                      全局快捷键
                    </CardTitle>
                    <CardDescription>自定义全局快捷键，在任何应用中快速访问 EVA 功能</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {hotkeyError && (
                      <div className="flex items-center gap-2 p-3 rounded-md bg-red-100 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm">
                        <AlertCircle className="h-4 w-4" />
                        {hotkeyError}
                      </div>
                    )}

                    <div className="space-y-3">
                      {Object.entries(hotkeys).map(([key, value]) => (
                        <div key={key} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                          <div>
                            <span className="font-medium">{hotkeyLabels[key] || key}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            {editingKey === key ? (
                              <>
                                <div
                                  className="flex items-center gap-1 px-3 py-1.5 rounded-md bg-purple-100 dark:bg-purple-900/30 border-2 border-purple-500 text-sm font-mono min-w-[120px] justify-center"
                                  tabIndex={0}
                                  onKeyDown={handleKeyDown}
                                  autoFocus
                                >
                                  {recordingKeys.length > 0 ? recordingKeys.join(' + ') : '按下快捷键...'}
                                </div>
                                <Button variant="ghost" size="sm" onClick={cancelRecording}>
                                  取消
                                </Button>
                              </>
                            ) : (
                              <>
                                <kbd className="px-2 py-1 rounded bg-muted text-sm font-mono">
                                  {value.replace('CommandOrControl', '⌘').replace('Alt', '⌥').replace('Shift', '⇧').replace('Control', '⌃').replace(/\+/g, ' ')}
                                </kbd>
                                <Button variant="ghost" size="sm" onClick={() => startRecording(key)}>
                                  <RefreshCw className="h-4 w-4" />
                                </Button>
                              </>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>

                    <p className="text-xs text-muted-foreground">
                      点击刷新按钮后，按下新的快捷键组合即可更改。快捷键在应用重启后生效。
                    </p>
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
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="flex items-center gap-2">
                          <Radio className="h-5 w-5 text-primary" />
                          API 服务 (AI Agent 接入)
                        </CardTitle>
                        <CardDescription>
                          管理本地 HTTP REST API 服务，供外部 AI Agent、自动化脚本安全获取桌面上下文
                        </CardDescription>
                      </div>
                      <div className="flex items-center gap-2">
                        {apiConfig.enabled ? (
                          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                            运行中 (127.0.0.1:{apiConfig.port})
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-muted text-muted-foreground border">
                            <span className="h-2 w-2 rounded-full bg-muted-foreground" />
                            已停用
                          </div>
                        )}
                      </div>
                    </div>
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
                    <div className="space-y-2">
                      <label className="text-sm font-medium flex items-center justify-between">
                        <span>访问凭证 (Bearer Token)</span>
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
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                          >
                            {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          className="gap-1.5"
                          onClick={handleCopyToken}
                        >
                          {copiedToken ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                          {copiedToken ? '已复制' : '复制'}
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        外部调用时必须在 HTTP 请求头添加 <code className="text-xs bg-muted px-1 rounded">Authorization: Bearer {apiConfig.token || '<token>'}</code>。
                      </p>
                    </div>

                    <div className="flex items-center gap-3 pt-2">
                      <Button
                        onClick={handleSaveApiConfig}
                        disabled={savingApiConfig}
                        className="gap-2"
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
                          Agent 接入与连通性测试
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
                        className="gap-1.5"
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
                          className={`text-xs px-2.5 py-1 rounded-md font-medium transition-colors ${
                            activeCodeLang === 'curl'
                              ? 'bg-primary text-primary-foreground'
                              : 'text-muted-foreground hover:text-foreground'
                          }`}
                        >
                          cURL
                        </button>
                        <button
                          onClick={() => setActiveCodeLang('python')}
                          className={`text-xs px-2.5 py-1 rounded-md font-medium transition-colors ${
                            activeCodeLang === 'python'
                              ? 'bg-primary text-primary-foreground'
                              : 'text-muted-foreground hover:text-foreground'
                          }`}
                        >
                          Python (requests)
                        </button>
                        <button
                          onClick={() => setActiveCodeLang('ts')}
                          className={`text-xs px-2.5 py-1 rounded-md font-medium transition-colors ${
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
                          {activeCodeLang === 'curl' &&
`curl -H "Authorization: Bearer ${apiConfig.token}" \\
  http://127.0.0.1:${apiConfig.port}/api/context`}
                          {activeCodeLang === 'python' &&
`import requests

url = "http://127.0.0.1:${apiConfig.port}/api/context"
headers = {"Authorization": "Bearer ${apiConfig.token}"}

response = requests.get(url, headers=headers)
context_data = response.json()
print("当前活跃应用:", context_data.get("activeWindow"))`}
                          {activeCodeLang === 'ts' &&
`const res = await fetch("http://127.0.0.1:${apiConfig.port}/api/context", {
  headers: {
    Authorization: "Bearer ${apiConfig.token}",
  },
});
const data = await res.json();
console.log("当前活跃应用:", data.activeWindow);`}
                        </pre>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="absolute right-2 top-2 h-7 px-2 text-xs"
                          onClick={() => {
                            const code =
                              activeCodeLang === 'curl'
                                ? `curl -H "Authorization: Bearer ${apiConfig.token}" http://127.0.0.1:${apiConfig.port}/api/context`
                                : activeCodeLang === 'python'
                                ? `import requests\n\nres = requests.get("http://127.0.0.1:${apiConfig.port}/api/context", headers={"Authorization": "Bearer ${apiConfig.token}"})\nprint(res.json())`
                                : `const res = await fetch("http://127.0.0.1:${apiConfig.port}/api/context", { headers: { Authorization: "Bearer ${apiConfig.token}" } });\nconsole.log(await res.json());`
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
                      <span>1.0.0</span>
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
