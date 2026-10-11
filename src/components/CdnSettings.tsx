import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  CheckCircle2,
  CloudUpload,
  Eye,
  EyeOff,
  Loader2,
  RefreshCw,
  XCircle,
} from 'lucide-react'

interface CdnConfigView {
  enabled: boolean
  provider: string
  aliyun: {
    accessKeyId: string
    accessKeySecretSet: boolean
    accessKeySecretMasked: string
    bucket: string
    area: string
    pathPrefix: string
    customUrl: string
  }
  r2: {
    accountId: string
    accessKeyId: string
    secretAccessKeySet: boolean
    bucket: string
    publicBaseUrl: string
    pathPrefix: string
  }
  piclistCompatEnabled: boolean
  piclistCompatPort: number
}

export function CdnSettings(): React.ReactElement {
  const [cfg, setCfg] = useState<CdnConfigView | null>(null)
  const [secretDraft, setSecretDraft] = useState('')
  const [showSecret, setShowSecret] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [saveOk, setSaveOk] = useState(false)
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const view = await window.api.cdn.getConfig()
      setCfg(view)
      setSecretDraft('')
    } catch (e: any) {
      setError(String(e?.message || e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const save = async () => {
    if (!cfg) return
    setSaving(true)
    setSaveOk(false)
    setError(null)
    try {
      const payload: any = {
        enabled: cfg.enabled,
        provider: cfg.provider,
        piclistCompatEnabled: cfg.piclistCompatEnabled,
        piclistCompatPort: cfg.piclistCompatPort,
        aliyun: {
          accessKeyId: cfg.aliyun.accessKeyId,
          bucket: cfg.aliyun.bucket,
          area: cfg.aliyun.area,
          pathPrefix: cfg.aliyun.pathPrefix,
          customUrl: cfg.aliyun.customUrl,
        },
        r2: {
          accountId: cfg.r2.accountId,
          accessKeyId: cfg.r2.accessKeyId,
          bucket: cfg.r2.bucket,
          publicBaseUrl: cfg.r2.publicBaseUrl,
          pathPrefix: cfg.r2.pathPrefix,
        },
      }
      if (secretDraft.trim() && !secretDraft.split('').every((c) => c === '*')) {
        payload.aliyun.accessKeySecret = secretDraft.trim()
      }
      const view = await window.api.cdn.saveConfig(payload)
      setCfg(view)
      setSecretDraft('')
      setSaveOk(true)
      setTimeout(() => setSaveOk(false), 2500)
    } catch (e: any) {
      setError(String(e?.message || e))
    } finally {
      setSaving(false)
    }
  }

  const test = async () => {
    setTesting(true)
    setTestMsg(null)
    try {
      const res = await window.api.cdn.testConnection()
      setTestMsg({ ok: !!res?.success, text: res?.message || '无结果' })
    } catch (e: any) {
      setTestMsg({ ok: false, text: String(e?.message || e) })
    } finally {
      setTesting(false)
    }
  }

  const importPiclist = async () => {
    setImporting(true)
    setError(null)
    try {
      const view = await window.api.cdn.importFromPiclist()
      setCfg(view)
      setSecretDraft('')
      setSaveOk(true)
      setTimeout(() => setSaveOk(false), 2500)
    } catch (e: any) {
      setError(String(e?.message || e))
    } finally {
      setImporting(false)
    }
  }

  if (loading || !cfg) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground p-6">
        <Loader2 className="h-4 w-4 animate-spin" />
        加载图床配置…
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div>
        <h3 className="text-base font-bold flex items-center gap-2">
          <CloudUpload className="h-5 w-5 text-primary" />
          图床
        </h3>
        <p className="text-xs text-muted-foreground mt-1">
          极简阿里云 OSS 上传；提供与 PicList 兼容的 <code className="font-mono">POST /upload</code>。
          密钥存入本机钥匙串，不会写入仓库。
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-xs text-red-600">
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">基础</CardTitle>
          <CardDescription>启用后，Obsidian / 脚本可走 EVA 上传并自动入库素材库</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">启用图床</div>
              <div className="text-xs text-muted-foreground">关闭后 /upload 会返回错误</div>
            </div>
            <Switch
              checked={cfg.enabled}
              onCheckedChange={(v) => setCfg({ ...cfg, enabled: v })}
            />
          </div>

          <div className="space-y-2">
            <div className="text-sm font-medium">Provider</div>
            <Select
              value={cfg.provider}
              onValueChange={(v) => setCfg({ ...cfg, provider: v })}
            >
              <SelectTrigger className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="aliyun">阿里云 OSS</SelectItem>
                <SelectItem value="r2" disabled>
                  Cloudflare R2（后置）
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">PicList 兼容端口</div>
              <div className="text-xs text-muted-foreground">
                额外监听 127.0.0.1:{cfg.piclistCompatPort}，Obsidian 插件可零改配置。若 PicList 仍占用该端口，请先退出 PicList，或改用{' '}
                <code className="font-mono">http://127.0.0.1:14220/upload</code>
              </div>
            </div>
            <Switch
              checked={cfg.piclistCompatEnabled}
              onCheckedChange={(v) => setCfg({ ...cfg, piclistCompatEnabled: v })}
            />
          </div>

          <div className="space-y-2 max-w-xs">
            <div className="text-sm font-medium">兼容端口号</div>
            <Input
              type="number"
              value={cfg.piclistCompatPort}
              onChange={(e) =>
                setCfg({ ...cfg, piclistCompatPort: Number(e.target.value) || 36677 })
              }
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">阿里云 OSS</CardTitle>
          <CardDescription>
            对象键格式：<code className="font-mono">img/YYYYMM/timestamp_rand.ext</code>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <div className="text-sm font-medium">AccessKeyId</div>
              <Input
                value={cfg.aliyun.accessKeyId}
                onChange={(e) =>
                  setCfg({
                    ...cfg,
                    aliyun: { ...cfg.aliyun, accessKeyId: e.target.value },
                  })
                }
                placeholder="LTAI..."
                autoComplete="off"
              />
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium flex items-center justify-between">
                <span>AccessKeySecret</span>
                {cfg.aliyun.accessKeySecretSet && (
                  <span className="text-[11px] text-emerald-600">已保存（钥匙串）</span>
                )}
              </div>
              <div className="flex gap-2">
                <Input
                  type={showSecret ? 'text' : 'password'}
                  value={secretDraft}
                  onChange={(e) => setSecretDraft(e.target.value)}
                  placeholder={
                    cfg.aliyun.accessKeySecretSet
                      ? cfg.aliyun.accessKeySecretMasked || '••••（留空则保持不变）'
                      : '输入 Secret'
                  }
                  autoComplete="new-password"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setShowSecret((s) => !s)}
                  className="shrink-0"
                >
                  {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium">Bucket</div>
              <Input
                value={cfg.aliyun.bucket}
                onChange={(e) =>
                  setCfg({ ...cfg, aliyun: { ...cfg.aliyun, bucket: e.target.value } })
                }
              />
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium">Region (area)</div>
              <Input
                value={cfg.aliyun.area}
                onChange={(e) =>
                  setCfg({ ...cfg, aliyun: { ...cfg.aliyun, area: e.target.value } })
                }
                placeholder="oss-cn-beijing"
              />
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium">路径前缀</div>
              <Input
                value={cfg.aliyun.pathPrefix}
                onChange={(e) =>
                  setCfg({
                    ...cfg,
                    aliyun: { ...cfg.aliyun, pathPrefix: e.target.value },
                  })
                }
                placeholder="img"
              />
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium">自定义域名（可选）</div>
              <Input
                value={cfg.aliyun.customUrl}
                onChange={(e) =>
                  setCfg({
                    ...cfg,
                    aliyun: { ...cfg.aliyun, customUrl: e.target.value },
                  })
                }
                placeholder="https://cdn.example.com"
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2 pt-2">
            <Button onClick={save} disabled={saving} className="gap-1.5">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              保存配置
            </Button>
            <Button variant="outline" onClick={test} disabled={testing} className="gap-1.5">
              {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              测试连接
            </Button>
            <Button variant="secondary" onClick={importPiclist} disabled={importing} className="gap-1.5">
              {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              从 PicList 导入
            </Button>
            {saveOk && (
              <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
                <CheckCircle2 className="h-3.5 w-3.5" /> 已保存
              </span>
            )}
          </div>

          {testMsg && (
            <div
              className={`rounded-xl border px-4 py-3 text-xs flex items-start gap-2 ${
                testMsg.ok
                  ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700'
                  : 'border-red-500/30 bg-red-500/5 text-red-600'
              }`}
            >
              {testMsg.ok ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
              ) : (
                <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
              )}
              <span className="whitespace-pre-wrap">{testMsg.text}</span>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">调用约定</CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground space-y-2 font-mono">
          <p>POST http://127.0.0.1:36677/upload</p>
          <p>POST http://127.0.0.1:14220/upload</p>
          <p>{`{"list":["/abs/path.png"]} → {"success":true,"result":["https://..."],"message":"success"}`}</p>
          <p>multipart 字段名：image 或 file</p>
        </CardContent>
      </Card>
    </div>
  )
}
