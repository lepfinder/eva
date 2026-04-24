/**
 * 环境探测工具 - 卡片版 UI
 */
import { useState, useEffect, useMemo } from 'react'
import { 
  Search, 
  RefreshCw, 
  Terminal, 
  ExternalLink,
  Info,
  Star,
  Plus,
  Sparkles,
  Check,
  Loader2
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { AI_PROVIDERS } from '@/components/AiProviderSettings'

interface EnvTool {
  id: string
  name: string
  category: string
  description?: string
  tags?: string[]
  installed: boolean
  version: string | null
  path: string | null
  command: string
  status: 'ok' | 'not_installed' | 'error'
  checkedAt: string
  error?: string
}

const CACHE_KEY = 'env-detector-cache'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 小时

interface EnvCache {
  tools: EnvTool[]
  scannedAt: number // timestamp
}

function loadCache(): EnvCache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as EnvCache
    // Validate cache structure
    if (!Array.isArray(parsed.tools)) {
      localStorage.removeItem(CACHE_KEY)
      return null
    }
    return parsed
  } catch {
    localStorage.removeItem(CACHE_KEY)
    return null
  }
}

function saveCache(tools: EnvTool[]) {
  const cache: EnvCache = { tools, scannedAt: Date.now() }
  localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
}

function isCacheExpired(scannedAt: number): boolean {
  return Date.now() - scannedAt > CACHE_TTL_MS
}

export function EnvDetector() {
  const [tools, setTools] = useState<EnvTool[]>([])
  const [loading, setLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedTool, setSelectedTool] = useState<EnvTool | null>(null)
  const [scannedAt, setScannedAt] = useState<number | null>(null)
  const [isFromCache, setIsFromCache] = useState(false)

  // AI 生成相关的状态
  const [isAIDialogOpen, setIsAIDialogOpen] = useState(false)
  const [isAIProcessing, setIsAIProcessing] = useState(false)
  const [aiStep, setAiStep] = useState<'config' | 'processing'>('config')
  const [processingIndex, setProcessingIndex] = useState(-1)
  const [processedIds, setProcessedIds] = useState<Set<string>>(new Set())
  const [skipExisting, setSkipExisting] = useState(true)

  const scanEnvironment = async (force = false) => {
    // 非强制扫描时先检查缓存
    if (!force) {
      const cache = loadCache()
      if (cache && !isCacheExpired(cache.scannedAt)) {
        const cachedTools = Array.isArray(cache.tools) ? cache.tools : []
        setTools(cachedTools)
        setScannedAt(cache.scannedAt)
        setIsFromCache(true)
        return
      }
    }
    setLoading(true)
    setIsFromCache(false)
    try {
      // @ts-ignore
      const results = await window.api.env.detect()
      const arr = Array.isArray(results) ? results : []
      setTools(arr)
      setScannedAt(Date.now())
      saveCache(arr)
    } catch (error) {
      console.error('Failed to detect environment:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    scanEnvironment()
  }, [])

  const filteredTools = useMemo(() => {
    if (!Array.isArray(tools)) return []
    return tools.filter(tool => {
        const matchesSearch = tool.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                             tool.id.toLowerCase().includes(searchQuery.toLowerCase())
        return matchesSearch
    })
  }, [tools, searchQuery])

  // 按状态分组
  const groups = useMemo(() => {
    return {
        installed: filteredTools.filter(t => t.installed),
        notInstalled: filteredTools.filter(t => !t.installed),
    }
  }, [filteredTools])

  // 模拟 Agent 友好度评分
  const getAgentScore = (id: string) => {
    const scores: Record<string, number> = {
        'python': 5,
        'node': 5,
        'git': 5,
        'ollama': 5,
        'ffmpeg': 4,
        'docker': 4,
        'pnpm': 5,
        'npm': 4,
        'jq': 5,
        'rg': 5,
        'gh': 5,
        'yt-dlp': 4,
        'go': 4,
        'rust': 4,
        'sqlite3': 4,
        'fzf': 5,
        'pandoc': 4,
        'stripe': 4,
        'elevenlabs': 5,
        'lark': 5,
        'dreamina': 4,
        'musicbox': 2
    }
    return scores[id] || 3
  }

  const renderStars = (score: number) => {
    return (
        <div className="flex gap-0.5 mt-1">
            {[1, 2, 3, 4, 5].map(i => (
                <Star 
                    key={i} 
                    className={`h-3 w-3 ${i <= score ? 'fill-blue-500 text-blue-500' : 'fill-muted text-muted'}`} 
                />
            ))}
        </div>
    )
  }

  // 真正的 AI 生成过程
  const startAIGeneration = async () => {
    const targets = (Array.isArray(tools) ? tools : []).filter(t => t.installed && (!skipExisting || !t.description || t.description.includes('暂无') || t.description.includes('暂未探测')))
    
    if (targets.length === 0) {
        alert('没有发现需要生成简介的工具。请尝试取消勾选“跳过已有简介”')
        return
    }

    // 读取设置页中配置的 AI 供应商
    const activeId = localStorage.getItem('eva:ai:activeProvider') || 'bailian'
    const cfgRaw = localStorage.getItem(`eva:ai:provider:${activeId}`)
    const providerCfg = cfgRaw ? JSON.parse(cfgRaw) : null
    const providerDef = AI_PROVIDERS.find(p => p.id === activeId)

    if (!providerCfg?.apiKey) {
        alert('请先在设置页 → AI 供应商中配置 API Key')
        return
    }

    setAiStep('processing')
    setIsAIProcessing(true)
    setProcessedIds(new Set())
    
    let currentTools = [...tools];

    // 获取 AI Engine 的 URL
    // @ts-ignore
    const serviceUrl = window.api.pythonGetInfo ? `http://127.0.0.1:${(await window.api.pythonGetInfo()).port}` : 'http://127.0.0.1:18888'

    for (let i = 0; i < targets.length; i++) {
        const tool = targets[i]
        setProcessingIndex(i)
        
        try {
            const response = await fetch(`${serviceUrl}/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: providerCfg.model || providerDef?.defaultModel,
                    provider: {
                        type: 'openai',
                        api_base: providerCfg.baseUrl || providerDef?.baseUrl,
                        api_key: providerCfg.apiKey
                    },
                    message: `请为开发工具 "${tool.name}" 写一段简短的中文介绍。
要求：
1. 字数控制在 25-40 字之间。
2. 描述其核心功能和开发场景。
3. 语气专业、干练，不要包含“这是一款...”、“为您提供...”等废话。
4. 直接输出内容，不要包含任何前缀或引号。`,
                    stream: false
                })
            })

            const data = await response.json()
            const newDesc = data.content?.trim() || tool.description
            
            // 更新内存状态
            currentTools = currentTools.map(t => t.id === tool.id ? {
                ...t,
                description: newDesc
            } : t);
            setTools([...currentTools]);
            
            // 持久化到主进程 JSON
            // @ts-ignore
            await window.api.env.saveDescription(tool.id, newDesc)
            
        } catch (error) {
            console.error(`Failed to generate for ${tool.name}:`, error)
        }
        
        setProcessedIds(prev => new Set(prev).add(tool.id))
    }
    
    setIsAIProcessing(false)
    saveCache(currentTools) 
    setTimeout(() => {
        setIsAIDialogOpen(false)
        setAiStep('config')
    }, 1500)
  }

  return (
    <div className="flex flex-col h-full space-y-6">
      {/* 顶部标题与操作 */}
      <div className="flex items-center justify-between">
        <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
                环境探测工具
                <Badge variant="outline" className="font-normal text-muted-foreground ml-2">
                    管理本地开发环境
                </Badge>
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
                自动识别本机已安装的命令行工具，并为 Agent 任务提供执行环境依据
            </p>
            {scannedAt && (
                <p className="text-xs text-muted-foreground/60 mt-1 flex items-center gap-1.5">
                    {isFromCache ? (
                        <span className="inline-flex items-center gap-1 text-blue-500/70">
                            <span className="inline-block h-1.5 w-1.5 rounded-full bg-blue-400"></span>
                            从缓存加载
                        </span>
                    ) : (
                        <span className="inline-flex items-center gap-1 text-green-500/70">
                            <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-400"></span>
                            实时扫描
                        </span>
                    )}
                    · 上次扫描于 {new Date(scannedAt).toLocaleString()}
                </p>
            )}
        </div>
        <div className="flex items-center gap-3">
             {/* 搜索框 */}
            <div className="relative w-64">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input 
                    placeholder="搜索工具..." 
                    className="pl-8 h-9"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                />
            </div>
            <Button size="sm" onClick={() => scanEnvironment(true)} disabled={loading}>
                <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                重新扫描
            </Button>
            <Button size="sm" variant="outline" className="text-primary border-primary">
                <Plus className="h-4 w-4 mr-2" />
                添加工具
            </Button>
        </div>
      </div>

      <ScrollArea className="flex-1 -mx-2 px-2">
        <div className="space-y-8">
            {/* 已安装区域 */}
            {groups.installed.length > 0 && (
                <section>
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-lg font-bold">已安装</h2>
                        <Button 
                            variant="ghost" 
                            size="sm" 
                            className="text-muted-foreground h-8 hover:text-blue-500"
                            onClick={() => setIsAIDialogOpen(true)}
                        >
                            <Sparkles className="h-3.5 w-3.5 mr-1 text-blue-500" />
                            AI 生成简介
                        </Button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {groups.installed.map(tool => (
                            <Card 
                                key={tool.id} 
                                className="group cursor-pointer hover:shadow-md hover:border-blue-500/50 transition-all border-muted/50"
                                onClick={() => setSelectedTool(tool)}
                            >
                                <CardHeader className="p-4 pb-2">
                                    <div className="flex items-start justify-between">
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2 mb-1">
                                                <CardTitle className="text-base">{tool.name}</CardTitle>
                                                <div className="flex flex-wrap gap-1">
                                                    {tool.tags?.map(tag => (
                                                        <Badge 
                                                            key={tag} 
                                                            variant="secondary" 
                                                            className="text-[10px] px-1.5 h-4 font-normal bg-muted text-muted-foreground"
                                                        >
                                                            {tag}
                                                        </Badge>
                                                    ))}
                                                </div>
                                                {tool.version && tool.version !== 'Unknown' && (
                                                    <Badge variant="outline" className="text-[10px] ml-auto font-mono bg-blue-500/5 text-blue-600/80 border-blue-200">
                                                        v{tool.version}
                                                    </Badge>
                                                )}
                                            </div>
                                            <p className="text-[12px] text-muted-foreground line-clamp-1">
                                                {tool.description || '暂无简介，可使用 AI 生成简介'}
                                            </p>
                                        </div>
                                    </div>
                                </CardHeader>
                                <CardContent className="p-4 pt-0">
                                    <div className="flex items-center gap-2 mt-2">
                                        <span className="text-[10px] text-muted-foreground">Agent 友好度</span>
                                        {renderStars(getAgentScore(tool.id))}
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                </section>
            )}

            {/* 未安装/推荐区域 */}
            {groups.notInstalled.length > 0 && (
                <section>
                    <h2 className="text-lg font-bold mb-4">推荐工具 / 未探测到</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pb-4">
                        {groups.notInstalled.map(tool => (
                            <Card 
                                key={tool.id} 
                                className="group cursor-pointer hover:shadow-md transition-all border-dashed opacity-70"
                                onClick={() => setSelectedTool(tool)}
                            >
                                <CardHeader className="p-4 pb-2">
                                    <div className="flex items-start justify-between">
                                        <div>
                                            <div className="flex items-center gap-2 mb-1">
                                                <CardTitle className="text-base text-muted-foreground">{tool.name}</CardTitle>
                                                {tool.tags?.map(tag => (
                                                    <Badge key={tag} variant="outline" className="text-[10px] px-1.5 h-4 font-normal">
                                                        {tag}
                                                    </Badge>
                                                ))}
                                            </div>
                                            <p className="text-[12px] text-muted-foreground line-clamp-1">
                                                {tool.description || '点击查看详情及安装说明'}
                                            </p>
                                        </div>
                                    </div>
                                </CardHeader>
                                <CardContent className="p-4 pt-0">
                                    <div className="mt-2">
                                        <Badge variant="secondary" className="text-[10px] font-normal">未探测到</Badge>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                </section>
            )}
        </div>
      </ScrollArea>

      {/* 详情对话框 */}
      <Dialog open={!!selectedTool} onOpenChange={() => setSelectedTool(null)}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-2">
                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                    <Terminal className="h-6 w-6" />
                </div>
                <div>
                    <DialogTitle className="text-xl">{selectedTool?.name}</DialogTitle>
                    <DialogDescription>
                        {selectedTool?.tags?.join(' · ') || '开发工具'}
                    </DialogDescription>
                </div>
            </div>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
             <div className="grid grid-cols-3 gap-2">
                <div className="text-sm text-muted-foreground border rounded-md p-3">
                    <div className="mb-1">当前状态</div>
                    <div>
                        {selectedTool?.installed ? 
                            <Badge variant="outline" className="border-green-500/50 bg-green-500/10 text-green-500">已安装</Badge> : 
                            <Badge variant="outline" className="text-muted-foreground">未检测到</Badge>
                        }
                    </div>
                </div>
                <div className="text-sm text-muted-foreground border rounded-md p-3 col-span-2">
                    <div className="mb-1">版本号</div>
                    <div className="font-mono text-foreground font-bold">{selectedTool?.version || 'N/A'}</div>
                </div>
             </div>

             <div className="space-y-2">
                <div className="text-sm font-medium flex items-center gap-2">
                    <Terminal className="h-4 w-4" />
                    可执行命令
                </div>
                <div className="bg-muted p-2 rounded text-xs font-mono break-all">
                    {selectedTool?.command}
                </div>
             </div>

             <div className="space-y-2">
                <div className="text-sm font-medium flex items-center gap-2">
                    <Info className="h-4 w-4" />
                    完整路径
                </div>
                <div className="bg-muted p-2 rounded text-xs font-mono break-all text-muted-foreground">
                    {selectedTool?.path || '未找到'}
                </div>
             </div>

             {selectedTool?.error && (
                <div className="bg-destructive/10 border border-destructive/20 p-3 rounded-md text-sm text-destructive">
                    <div className="font-bold flex items-center gap-2 mb-1">
                        <Star className="h-4 w-4" />
                        错误信息
                    </div>
                    <p className="font-mono text-xs">{selectedTool.error}</p>
                </div>
             )}
          </div>

          <div className="flex justify-end gap-3 mt-4">
            {selectedTool?.path && (
                <Button variant="outline" size="sm" onClick={() => {
                    // @ts-ignore
                    window.api.app.openInFinder(selectedTool.path)
                }}>
                    <ExternalLink className="h-4 w-4 mr-2" />
                    在资源管理器中查看
                </Button>
            )}
            <Button onClick={() => setSelectedTool(null)}>确定</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* AI 生成简介弹窗 */}
      <Dialog open={isAIDialogOpen} onOpenChange={(open) => !isAIProcessing && setIsAIDialogOpen(open)}>
        <DialogContent className="sm:max-w-[500px] p-0 overflow-hidden gap-0">
          <div className="p-6">
            <DialogHeader className="mb-6">
                <DialogTitle className="text-xl flex items-center gap-2">
                    <Sparkles className="h-5 w-5 text-blue-500" />
                    AI 生成简介
                </DialogTitle>
                <DialogDescription>
                    使用 AI 为已安装的工具批量生成简介，生成后将显示在工具卡片上。
                </DialogDescription>
            </DialogHeader>

            {aiStep === 'config' ? (
                <div className="space-y-6 py-2">
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-muted-foreground">当前使用的模型</label>
                        <div className="flex items-center justify-between rounded-md border bg-muted/50 px-3 py-2 text-sm">
                            <span className="font-medium">{(() => {
                                const activeId = localStorage.getItem('eva:ai:activeProvider') || 'bailian'
                                const cfgRaw = localStorage.getItem(`eva:ai:provider:${activeId}`)
                                const cfg = cfgRaw ? JSON.parse(cfgRaw) : null
                                const def = AI_PROVIDERS.find(p => p.id === activeId)
                                return cfg?.model || def?.defaultModel || '未配置'
                            })()}</span>
                            <span className="text-xs text-muted-foreground">在设置页 → AI 供应商中配置</span>
                        </div>
                    </div>

                    <div className="flex items-center space-x-2 pt-2">
                        <Checkbox 
                            id="skip" 
                            checked={skipExisting} 
                            onCheckedChange={(checked) => setSkipExisting(!!checked)} 
                        />
                        <label 
                            htmlFor="skip" 
                            className="text-sm font-medium leading-none cursor-pointer select-none"
                        >
                            跳过已有简介的工具 ({(Array.isArray(tools) ? tools : []).filter(t => t.installed && t.description && !t.description.includes('暂无')).length} 个)
                        </label>
                    </div>

                    <p className="text-xs text-muted-foreground">
                        将处理 {(Array.isArray(tools) ? tools : []).filter(t => t.installed && (!skipExisting || !t.description || t.description.includes('暂无'))).length} / {(Array.isArray(tools) ? tools : []).filter(t => t.installed).length} 个工具
                    </p>
                </div>
            ) : (
                <div className="py-2">
                    <ScrollArea className="h-[300px] pr-4">
                        <div className="space-y-3">
                            {(Array.isArray(tools) ? tools : []).filter(t => t.installed && (!skipExisting || !t.description || t.description.includes('暂无'))).map((tool, idx) => {
                                const isDone = processedIds.has(tool.id)
                                const isCurrent = idx === processingIndex
                                return (
                                    <div key={tool.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/30">
                                        <div className="flex items-center gap-3">
                                            <div className="h-6 w-6 flex items-center justify-center">
                                                {isDone ? (
                                                    <div className="h-5 w-5 rounded-full bg-green-500/20 flex items-center justify-center">
                                                        <Check className="h-3 w-3 text-green-600" />
                                                    </div>
                                                ) : isCurrent ? (
                                                    <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                                                ) : (
                                                    <div className="h-4 w-4 rounded-full border-2 border-muted" />
                                                )}
                                            </div>
                                            <span className={`text-sm ${isCurrent ? 'font-medium text-blue-600' : 'text-muted-foreground'}`}>
                                                {tool.name}
                                            </span>
                                        </div>
                                        {isCurrent && (
                                            <Badge variant="outline" className="text-[10px] animate-pulse border-blue-500/30 text-blue-500">
                                                正在生成...
                                            </Badge>
                                        )}
                                    </div>
                                )
                            })}
                        </div>
                    </ScrollArea>
                </div>
            )}
          </div>

          <DialogFooter className="bg-muted/30 p-4 border-t gap-3">
            {aiStep === 'config' ? (
                <>
                    <Button variant="ghost" onClick={() => setIsAIDialogOpen(false)}>取消</Button>
                    <Button 
                        className="bg-blue-600 hover:bg-blue-700 text-white gap-2 h-10 px-6 rounded-full"
                        onClick={startAIGeneration}
                    >
                        <Sparkles className="h-4 w-4" />
                        开始生成工具简介
                    </Button>
                </>
            ) : (
                <Button variant="ghost" onClick={() => setIsAIDialogOpen(false)}>取消</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
