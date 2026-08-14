/**
 * AI 供应商配置
 * - 支持: 百炼、DeepSeek、GLM、MiniMax、Google Gemini
 * - 每个供应商的 key 独立持久化到 localStorage
 * - 模型可自定义
 * - 当前激活供应商也持久化
 */
import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { ExternalLink, Key, Cpu, Globe, CheckCircle2, AlertCircle, Loader2, Flame, Bot, Brain, Zap, Sparkles, type LucideIcon } from 'lucide-react'

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

export interface ProviderConfig {
  apiKey: string
  model: string
  baseUrl: string  // 允许用户覆盖
}

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

  const provider = AI_PROVIDERS.find(p => p.id === activeId)!
  const cfg = configs[activeId]

  // 切换供应商时持久化选择
  const handleSwitchProvider = (id: string) => {
    setActiveId(id)
    localStorage.setItem(LS_ACTIVE, id)
    setTestStatus('idle')
    setTestMessage('')
  }

  const updateCfg = (patch: Partial<ProviderConfig>) => {
    setConfigs(prev => ({ ...prev, [activeId]: { ...prev[activeId], ...patch } }))
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

  // 连接测试：发一个最小 chat 请求
  const handleTest = async () => {
    if (!cfg.apiKey.trim()) {
      setTestStatus('error')
      setTestMessage('请先填写 API Key')
      return
    }
    setTestStatus('loading')
    setTestMessage('')
    try {
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
    } catch (e: any) {
      setTestStatus('error')
      setTestMessage(e?.message || '网络错误')
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
            <Label className="uppercase text-xs tracking-widest text-muted-foreground">模型</Label>
            <div className="space-y-2">
              {/* 快速选择常用模型 */}
              <div className="flex flex-wrap gap-1.5">
                {provider.models.map(m => (
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
              </div>
              {/* 自定义输入 */}
              <Input
                value={cfg.model}
                onChange={e => updateCfg({ model: e.target.value })}
                placeholder="或输入自定义模型名"
                className="font-mono text-xs"
              />
            </div>
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
