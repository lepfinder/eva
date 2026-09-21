/**
 * AI 供应商配置
 * - 支持: 百炼、DeepSeek、GLM、MiniMax、Google Gemini
 * - 每个供应商的 key 独立持久化到 localStorage
 * - 模型可自定义
 * - 当前激活供应商也持久化
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import { ExternalLink, Key, Cpu, Globe, CheckCircle2, AlertCircle, Loader2, Flame, Bot, Brain, Zap, Sparkles, type LucideIcon } from 'lucide-react'
import { History, Trash2, RefreshCw, ChevronDown, ChevronRight, Copy, Check } from 'lucide-react'

// ─── 供应商定义 ────────────────────────────────────────────────────────────────

export interface AiProvider {
  id: string
  name: string
  icon: LucideIcon
  baseUrl: string
  defaultModel: string
  models: string[]          // 常用模型快速选
  apiKeyLink: string
  apiKeyPlaceholder: string
}

export const AI_PROVIDERS: AiProvider[] = [
  {
    id: 'bailian',
    name: '通义千问（百炼）',
    icon: Flame,
    baseUrl: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen3.8-max',
    models: ['qwen3.8-max', 'qwen3.6-flash', 'kimi-k2.7-code', 'kimi-k2.6', 'deepseek-v4-pro'],
    apiKeyLink: 'https://bailian.console.aliyun.com/cn-beijing?tab=plan#/efm/subscription/token-plan/enterprise',
    apiKeyPlaceholder: 'sk-...',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    icon: Bot,
    baseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-v4-flash',
    models: ['deepseek-v4-flash', 'deepseek-v4-pro'],
    apiKeyLink: 'https://platform.deepseek.com/api_keys',
    apiKeyPlaceholder: 'sk-...',
  },
  {
    id: 'volcano_ark_coding_plan',
    name: '火山方舟 coding plan',
    icon: Sparkles,
    baseUrl: 'https://ark.cn-beijing.volces.com/api/coding',
    defaultModel: 'deepseek-v4-flash',
    models: ['deepseek-v4-flash', 'doubao-seed-2.0-mini', 'doubao-seed-evolving', 'minimax-m3', 'kimi-k2.7-code', 'kimi-k3'],
    apiKeyLink: 'https://console.volcengine.com/ark/region:cn-beijing/subscription/coding-plan?projectName=default',
    apiKeyPlaceholder: 'sk-...',
  },
]

// ─── localStorage 存储 key ────────────────────────────────────────────────────

const LS_ACTIVE = 'eva:ai:activeProvider'
const lsKey = (providerId: string) => `eva:ai:provider:${providerId}`
const lsModelsKey = (providerId: string) => `eva:ai:models:${providerId}`

export interface ProviderConfig {
  apiKey: string
  model: string
  baseUrl: string  // 允许用户覆盖
  /** 多模态模型（剪贴板图片识别用），留空则回退到 model */
  visionModel?: string
  /** 图片识别指令，留空使用 DEFAULT_OCR_PROMPT */
  ocrPrompt?: string
}

export const DEFAULT_OCR_PROMPT = '你是协助编码 Agent 理解截图的助手。请描述这张图片的基本结构与用途：1) 界面类型（网页/桌面应用/弹窗/报错页/终端等）；2) 布局区块及层级（导航、侧栏、主内容区、页脚等）；3) 关键 UI 组件及其位置与状态（按钮、输入框、表格、代码块、开关等）；4) 需要原样保留的关键文本（报错信息、字段标签、代码片段、URL 等）。输出简明的结构化描述，不要逐字转录全部内容。'

function loadConfig(providerId: string, defaults: AiProvider): ProviderConfig {
  try {
    const raw = localStorage.getItem(lsKey(providerId))
    if (raw) return JSON.parse(raw) as ProviderConfig
  } catch { }
  return { apiKey: '', model: defaults.defaultModel, baseUrl: defaults.baseUrl }
}

function saveConfig(providerId: string, cfg: ProviderConfig) {
  localStorage.setItem(lsKey(providerId), JSON.stringify(cfg))
}

// ─── 组件 ─────────────────────────────────────────────────────────────────────

type TestStatus = 'idle' | 'loading' | 'ok' | 'error'

export function AiProviderSettings() {
  const [activeId, setActiveId] = useState<string>(() => {
    return localStorage.getItem(LS_ACTIVE) || 'bailian'
  })

  // 每个 provider 的配置独立存 state（内存 + localStorage）
  const [configs, setConfigs] = useState<Record<string, ProviderConfig>>(() => {
    const initial: Record<string, ProviderConfig> = {}
    AI_PROVIDERS.forEach(p => { initial[p.id] = loadConfig(p.id, p) })
    return initial
  })

  const [testStatus, setTestStatus] = useState<TestStatus>('idle')
  const [testMessage, setTestMessage] = useState('')

  // 远端拉取的模型列表（按 provider 缓存到 localStorage）
  const [fetchedModels, setFetchedModels] = useState<Record<string, string[]>>(() => {
    const initial: Record<string, string[]> = {}
    AI_PROVIDERS.forEach(p => {
      try {
        const raw = localStorage.getItem(lsModelsKey(p.id))
        if (raw) {
          const arr = JSON.parse(raw)
          if (Array.isArray(arr)) initial[p.id] = arr.filter((m: unknown) => typeof m === 'string' && m)
        }
      } catch { }
    })
    return initial
  })
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState('')
  const [modelSearch, setModelSearch] = useState('')

  const provider = AI_PROVIDERS.find(p => p.id === activeId)!
  const cfg = configs[activeId]
  const remoteModels = fetchedModels[activeId]
  const filteredRemote = remoteModels
    ? remoteModels.filter(m => m.toLowerCase().includes(modelSearch.toLowerCase()))
    : null

  // 切换供应商时持久化选择
  const handleSwitchProvider = (id: string) => {
    setActiveId(id)
    localStorage.setItem(LS_ACTIVE, id)
    setTestStatus('idle')
    setTestMessage('')
    setModelSearch('')
    setModelsError('')
  }

  const updateCfg = (patch: Partial<ProviderConfig>) => {
    setConfigs(prev => ({ ...prev, [activeId]: { ...prev[activeId], ...patch } }))
  }

  // 拉取远端模型列表；失败时保留内置列表兜底
  const fetchModels = async () => {
    if (!cfg.apiKey.trim() || modelsLoading) return
    setModelsLoading(true)
    setModelsError('')
    try {
      const list = await window.api.ai.listModels(cfg.baseUrl, cfg.apiKey)
      const arr = Array.isArray(list) ? list.filter(m => typeof m === 'string' && m) : []
      if (arr.length === 0) {
        setModelsError('接口未返回模型列表')
        return
      }
      setFetchedModels(prev => ({ ...prev, [activeId]: arr }))
      localStorage.setItem(lsModelsKey(activeId), JSON.stringify(arr))
    } catch (e) {
      setModelsError(String((e as Error)?.message || e || '拉取失败'))
    } finally {
      setModelsLoading(false)
    }
  }

  const handleSave = () => {
    saveConfig(activeId, cfg)
    setTestStatus('idle')
    setTestMessage('已保存')
    setTimeout(() => setTestMessage(''), 2000)
  }

  const handleClear = () => {
    const fresh = { apiKey: '', model: provider.defaultModel, baseUrl: provider.baseUrl }
    setConfigs(prev => ({ ...prev, [activeId]: fresh }))
    saveConfig(activeId, fresh)
    setTestStatus('idle')
    setTestMessage('')
  }

  // 连接测试：通过 Rust 后端代理发一个最小 chat 请求（避免浏览器 CORS/Preflight 拦截）
  const handleTest = async () => {
    if (!cfg.apiKey.trim()) {
      setTestStatus('error')
      setTestMessage('请先填写 API Key')
      return
    }
    setTestStatus('loading')
    setTestMessage('')
    try {
      if (window.api?.ai?.chatCompletion) {
        await window.api.ai.chatCompletion({
          baseUrl: cfg.baseUrl,
          apiKey: cfg.apiKey,
          model: cfg.model,
          messages: [{ role: 'user', content: 'hi' }],
          maxTokens: 5,
          source: 'provider-test',
        })
        setTestStatus('ok')
        setTestMessage('连接成功')
      } else {
        const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${cfg.apiKey}`,
          },
          body: JSON.stringify({
            model: cfg.model,
            messages: [{ role: 'user', content: 'hi' }],
            max_tokens: 5,
          }),
        })
        if (res.ok) {
          setTestStatus('ok')
          setTestMessage('连接成功')
        } else {
          const json = await res.json().catch(() => ({}))
          setTestStatus('error')
          setTestMessage(json?.error?.message || `HTTP ${res.status}`)
        }
      }
    } catch (e: any) {
      setTestStatus('error')
      setTestMessage(e?.message || '连接失败')
    }
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Cpu className="h-5 w-5" />
            AI 供应商配置
          </CardTitle>
          <CardDescription>
            配置 AI 模型供应商，各供应商的 API Key 独立保存，切换不丢失。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">

          {/* Provider 选择 */}
          <div className="space-y-2">
            <Label>供应商</Label>
            <Select value={activeId} onValueChange={handleSwitchProvider}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AI_PROVIDERS.map(p => (
                  <SelectItem key={p.id} value={p.id}>
                    <span className="flex items-center gap-2">
                      <p.icon className="h-4 w-4 text-muted-foreground" />
                      <span>{p.name}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Separator />

          {/* BASE URL */}
          <div className="space-y-2">
            <Label className="uppercase text-xs tracking-widest text-muted-foreground">Base URL</Label>
            <div className="flex items-center gap-2">
              <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
              <Input
                value={cfg.baseUrl}
                onChange={e => updateCfg({ baseUrl: e.target.value })}
                placeholder={provider.baseUrl}
                className="font-mono text-xs"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              默认: {provider.baseUrl}
            </p>
          </div>

          {/* API KEY */}
          <div className="space-y-2">
            <Label className="uppercase text-xs tracking-widest text-muted-foreground">API Key</Label>
            <a
              href={provider.apiKeyLink}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
              onClick={e => { e.preventDefault(); window.open(provider.apiKeyLink) }}
            >
              <ExternalLink className="h-3 w-3" />
              获取 API Key
            </a>
            <div className="flex items-center gap-2">
              <Key className="h-4 w-4 text-muted-foreground shrink-0" />
              <Input
                type="password"
                value={cfg.apiKey}
                onChange={e => updateCfg({ apiKey: e.target.value })}
                placeholder={provider.apiKeyPlaceholder}
                className="font-mono text-xs"
                autoComplete="off"
              />
            </div>
          </div>

          {/* MODEL */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="uppercase text-xs tracking-widest text-muted-foreground">模型</Label>
              <Button
                variant="ghost"
                size="sm"
                onClick={fetchModels}
                disabled={!cfg.apiKey.trim() || modelsLoading}
                className="h-6 gap-1 px-2 text-xs text-muted-foreground"
              >
                {modelsLoading
                  ? <Loader2 className="h-3 w-3 animate-spin" />
                  : <RefreshCw className="h-3 w-3" />}
                拉取模型列表
              </Button>
            </div>
            <div className="space-y-2">
              {remoteModels && (
                <Input
                  value={modelSearch}
                  onChange={e => setModelSearch(e.target.value)}
                  placeholder={`搜索模型（共 ${remoteModels.length} 个）`}
                  className="text-xs"
                />
              )}
              {/* 快速选择：远端列表优先，未拉取/失败时用内置列表 */}
              <div className={`flex flex-wrap gap-1.5 ${remoteModels ? 'max-h-40 overflow-y-auto' : ''}`}>
                {(filteredRemote ?? provider.models).map(m => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => updateCfg({ model: m })}
                    className={`px-2.5 py-1 rounded-full text-xs font-mono border transition-colors ${cfg.model === m
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-muted text-muted-foreground border-border hover:border-primary/50 hover:text-foreground'
                      }`}
                  >
                    {m}
                  </button>
                ))}
                {remoteModels && filteredRemote!.length === 0 && (
                  <span className="text-xs text-muted-foreground">无匹配模型</span>
                )}
              </div>
              {modelsError && (
                <p className="text-xs text-destructive">{modelsError}，已显示内置列表</p>
              )}
              {/* 自定义输入 */}
              <Input
                value={cfg.model}
                onChange={e => updateCfg({ model: e.target.value })}
                placeholder="或输入自定义模型名"
                className="font-mono text-xs"
              />
            </div>
          </div>

          {/* VISION MODEL */}
          <div className="space-y-2">
            <Label className="uppercase text-xs tracking-widest text-muted-foreground">多模态模型（图片识别）</Label>
            <div className="flex items-center gap-2">
              <Brain className="h-4 w-4 text-muted-foreground shrink-0" />
              <Input
                value={cfg.visionModel || ''}
                onChange={e => updateCfg({ visionModel: e.target.value })}
                placeholder={`留空则使用当前模型：${cfg.model}`}
                className="font-mono text-xs"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              用于剪贴板图片 AI 识别（⌘⇧;），需支持 OpenAI vision 格式的模型，如 qwen-vl-max
            </p>
          </div>

          {/* OCR PROMPT */}
          <div className="space-y-2">
            <Label className="uppercase text-xs tracking-widest text-muted-foreground">图片识别指令</Label>
            <Input
              value={cfg.ocrPrompt || ''}
              onChange={e => updateCfg({ ocrPrompt: e.target.value })}
              placeholder={DEFAULT_OCR_PROMPT}
              className="text-xs"
            />
          </div>

          <Separator />

          {/* 操作按钮 */}
          <div className="flex items-center gap-3">
            <Button onClick={handleSave} className="gap-1.5">
              保存
            </Button>
            <Button variant="outline" onClick={handleClear} className="gap-1.5 text-destructive border-destructive/40 hover:bg-destructive/10">
              清除
            </Button>
            <Button variant="ghost" onClick={handleTest} disabled={testStatus === 'loading'} className="gap-1.5">
              {testStatus === 'loading'
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <CheckCircle2 className="h-4 w-4" />}
              测试连接
            </Button>

            {/* 状态提示 */}
            {testMessage && (
              <span className={`flex items-center gap-1 text-xs ${testStatus === 'ok' ? 'text-green-600' :
                testStatus === 'error' ? 'text-destructive' :
                  'text-muted-foreground'
                }`}>
                {testStatus === 'ok' && <CheckCircle2 className="h-3.5 w-3.5" />}
                {testStatus === 'error' && <AlertCircle className="h-3.5 w-3.5" />}
                {testMessage}
              </span>
            )}
          </div>

        </CardContent>
      </Card>
    </div>
  )
}

// ─── AI 调用记录 ───────────────────────────────────────────────────────────────

interface AiCallRecord {
  id: number
  createdAt: number
  source: string
  model: string
  status: string
  errorMsg: string
  reqBytes: number
  imageBytes: number
  elapsedMs: number
  prompt: string
  response: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  imageHash: string
}

const SOURCE_LABELS: Record<string, string> = {
  'ocr': '图片识别',
  'provider-test': '连接测试',
  'time-auditor': '时间审计',
  'speech-bubble': '气泡提示',
  'app-category': '应用分类',
}

function fmtBytes(n: number): string {
  if (!n) return '-'
  if (n < 1024) return `${n}B`
  return `${(n / 1024).toFixed(0)}KB`
}

function fmtTime(ms: number): string {
  const d = new Date(ms)
  const pad = (x: number) => String(x).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

const PAGE_SIZE = 50

export function AiCallHistory() {
  const [calls, setCalls] = useState<AiCallRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [imageCache, setImageCache] = useState<Record<string, string>>({})
  const [lightboxHash, setLightboxHash] = useState<string | null>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)

  const copyText = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedKey(key)
      setTimeout(() => setCopiedKey(k => (k === key ? null : k)), 1500)
    } catch { /* clipboard unavailable */ }
  }

  const load = useCallback(async (reset = false) => {
    setLoading(true)
    try {
      const offset = reset ? 0 : calls.length
      const rows = await window.api?.ai?.listCalls?.(PAGE_SIZE, offset)
      const list: AiCallRecord[] = Array.isArray(rows) ? rows : []
      setCalls(prev => (reset ? list : [...prev, ...list]))
      setHasMore(list.length === PAGE_SIZE)
    } catch {
      if (reset) setCalls([])
      setHasMore(false)
    } finally {
      setLoading(false)
    }
  }, [calls.length])

  useEffect(() => { void load(true) }, [])

  // 触底自动加载下一页
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMore && !loading) void load(false)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasMore, loading, load])

  // 展开带图记录时按需加载原图（ai-images 存档）
  useEffect(() => {
    const rec = expandedId == null ? undefined : calls.find(c => c.id === expandedId)
    const hash = rec?.imageHash
    if (!hash || hash in imageCache) return
    let cancelled = false
    window.api?.ai?.getImageByHash?.(hash)
      .then((dataUrl: string | null) => {
        if (!cancelled) setImageCache(prev => ({ ...prev, [hash]: dataUrl || '' }))
      })
      .catch(() => { if (!cancelled) setImageCache(prev => ({ ...prev, [hash]: '' })) })
    return () => { cancelled = true }
  }, [expandedId, calls, imageCache])

  const clear = async () => {
    try {
      await window.api?.ai?.clearCalls?.()
      setCalls([])
      setHasMore(false)
    } catch { /* keep list */ }
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              AI 调用记录
            </CardTitle>
            <CardDescription className="mt-1.5">
              完整记录提示词、返回内容与 token 消耗，滚动到底自动加载更多。
            </CardDescription>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => void load(true)} disabled={loading} className="gap-1.5 text-xs text-muted-foreground">
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              刷新
            </Button>
            <Button variant="ghost" size="sm" onClick={clear} disabled={calls.length === 0} className="gap-1.5 text-xs text-muted-foreground hover:text-destructive">
              <Trash2 className="h-3.5 w-3.5" />
              清空
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {calls.length === 0 && !loading ? (
          <p className="text-sm text-muted-foreground">暂无调用记录。</p>
        ) : (
          <div className="divide-y divide-border">
            {calls.map(c => {
              const expanded = expandedId === c.id
              return (
                <div key={c.id}>
                  <button
                    type="button"
                    onClick={() => setExpandedId(expanded ? null : c.id)}
                    className="w-full flex items-center gap-3 py-2 text-left text-xs hover:bg-muted/50 rounded-md px-1"
                  >
                    {expanded
                      ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                    <span className="font-mono text-muted-foreground shrink-0">{fmtTime(c.createdAt)}</span>
                    <span className="shrink-0">{SOURCE_LABELS[c.source] || c.source || '未知'}</span>
                    <span className="font-mono truncate text-muted-foreground">{c.model}</span>
                    <span className="ml-auto flex items-center gap-3 shrink-0 text-muted-foreground">
                      <span>{c.imageBytes ? `图 ${fmtBytes(c.imageBytes)} · ` : ''}{fmtBytes(c.reqBytes)}</span>
                      <span>{c.totalTokens ? `${c.promptTokens}/${c.completionTokens} tok` : '-'}</span>
                      <span>{c.elapsedMs}ms</span>
                      {c.status === 'ok'
                        ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                        : <AlertCircle className="h-3.5 w-3.5 text-destructive" />}
                    </span>
                  </button>
                  {expanded && (
                    <div className="space-y-3 pb-3 px-1 pl-6">
                      {c.errorMsg && (
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">错误</p>
                          <p className="text-xs font-mono text-destructive whitespace-pre-wrap break-all">{c.errorMsg}</p>
                        </div>
                      )}
                      {c.imageHash && imageCache[c.imageHash] && (
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">原图</p>
                          <img
                            src={imageCache[c.imageHash]}
                            alt="识别原图"
                            onClick={() => setLightboxHash(c.imageHash)}
                            className="max-h-40 rounded-md border border-border cursor-zoom-in"
                          />
                        </div>
                      )}
                      {c.prompt && (
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">提示词</p>
                          <div className="max-h-48 overflow-y-auto rounded-md bg-muted/50 p-3">
                            <p className="text-xs font-mono whitespace-pre-wrap break-all">{c.prompt}</p>
                          </div>
                        </div>
                      )}
                      {c.response && (
                        <div>
                          <div className="mb-1 flex items-center justify-between">
                            <p className="text-xs text-muted-foreground">返回内容</p>
                            <button
                              type="button"
                              onClick={() => void copyText(`resp-${c.id}`, c.response)}
                              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded transition-colors"
                            >
                              {copiedKey === `resp-${c.id}`
                                ? <><Check className="h-3 w-3 text-green-600" />已复制</>
                                : <><Copy className="h-3 w-3" />复制</>}
                            </button>
                          </div>
                          <div className="max-h-64 overflow-y-auto rounded-md bg-muted/50 p-3">
                            <p className="text-xs font-mono whitespace-pre-wrap break-all">{c.response}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
        {calls.length > 0 && (
          <div ref={sentinelRef} className="flex items-center justify-center py-3 text-xs text-muted-foreground">
            {loading && <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />加载中…</>}
            {!loading && !hasMore && '已加载全部'}
          </div>
        )}
      </CardContent>
    </Card>

    <Dialog open={!!lightboxHash} onOpenChange={open => { if (!open) setLightboxHash(null) }}>
      <DialogContent className="max-w-[min(96vw,1100px)] w-full gap-3 p-4 sm:rounded-xl">
        <DialogHeader className="pr-8 text-left">
          <DialogTitle className="text-base">原图预览</DialogTitle>
        </DialogHeader>
        {lightboxHash && imageCache[lightboxHash] && (
          <div className="flex max-h-[min(78vh,820px)] items-center justify-center overflow-auto rounded-lg bg-muted/50 p-2">
            <img
              src={imageCache[lightboxHash]}
              alt="识别原图"
              className="max-h-[min(76vh,800px)] w-auto max-w-full object-contain"
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
    </div>
  )
}

// ─── 供外部使用的辅助函数 ──────────────────────────────────────────────────────

/** 获取当前激活供应商的配置（用于 activity_generate_summary 等功能） */
export function getActiveAiConfig(): { provider: AiProvider; config: ProviderConfig } | null {
  const activeId = localStorage.getItem(LS_ACTIVE) || 'bailian'
  const provider = AI_PROVIDERS.find(p => p.id === activeId)
  if (!provider) return null
  const config = loadConfig(activeId, provider)
  if (!config.apiKey.trim()) return null
  return { provider, config }
}
