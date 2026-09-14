/**
 * Guided registration session: chat timeline + decision gates.
 * Loop tools stay local; UI presents steps and waits on conflicts.
 */
import { getActiveAiConfig } from '@/components/AiProviderSettings'
import type { CandidateConfig, ProbeReport, ServiceDefinition } from '@/types/serviceCandidate'

export type SessionPhase =
  | 'idle'
  | 'scanning'
  | 'awaiting_decision'
  | 'probing'
  | 'revising'
  | 'ready'
  | 'failed'
  | 'committed'

export type DecisionType =
  | 'port_conflict'
  | 'probe_failed'
  | 'confirm_commit'
  | 'after_scan'

export interface DecisionOption {
  id: string
  label: string
  description?: string
  variant?: 'default' | 'outline' | 'destructive' | 'secondary'
}

export interface DecisionRequest {
  id: string
  type: DecisionType
  prompt: string
  options: DecisionOption[]
  allowCustomPort?: boolean
}

export interface ChatMessage {
  id: string
  role: 'eva' | 'user' | 'system'
  content: string
  at: number
  kind?: 'text' | 'scan' | 'probe' | 'decision' | 'log'
  evidence?: string[]
  warnings?: string[]
  recipe?: string
  confidence?: number
  report?: ProbeReport
  decision?: DecisionRequest
  resolvedChoiceId?: string
  collapsedLog?: string
}

export interface SessionProgress {
  /** Short title shown above the bar */
  label: string
  /** Extra line, e.g. command or model name */
  detail?: string
  kind: 'scan' | 'probe' | 'ai' | 'commit'
  startedAt: number
  /** When set, bar is determinate toward this duration */
  expectedMs?: number
}

export interface SessionSnapshot {
  phase: SessionPhase
  projectDir: string
  candidate: CandidateConfig | null
  report: ProbeReport | null
  attempt: number
  messages: ChatMessage[]
  pendingDecision: DecisionRequest | null
  busy: boolean
  error: string | null
  progress: SessionProgress | null
}

const PROBE_TIMEOUT_SECS = 35
const MAX_AUTO_AI_REVISE = 2

function yieldToUi(): Promise<void> {
  return new Promise((r) => setTimeout(r, 40))
}

let msgSeq = 0
function mid(prefix: string): string {
  msgSeq += 1
  return `${prefix}-${Date.now()}-${msgSeq}`
}

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const raw = fenced ? fenced[1].trim() : trimmed
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) {
    throw new Error('模型未返回 JSON 对象')
  }
  return JSON.parse(raw.slice(start, end + 1))
}

function mergeDefinitionPatch(
  base: ServiceDefinition,
  patch: Partial<ServiceDefinition> & {
    start?: Partial<ServiceDefinition['start']>
    health?: Partial<ServiceDefinition['health']>
    stop?: Partial<NonNullable<ServiceDefinition['stop']>>
  }
): ServiceDefinition {
  const next: ServiceDefinition = {
    ...base,
    ...patch,
    start: {
      ...base.start,
      ...(patch.start ?? {}),
      command: patch.start?.command ?? base.start.command,
      cwd: patch.start?.cwd ?? base.start.cwd,
      env: patch.start?.env ?? base.start.env ?? {},
    },
    health: {
      ...base.health,
      ...(patch.health ?? {}),
    },
    stop: {
      ...(base.stop ?? {}),
      ...(patch.stop ?? {}),
      cleanupPorts: patch.stop?.cleanupPorts ?? patch.ports ?? base.stop?.cleanupPorts ?? base.ports,
    },
  }
  next.id = base.id
  next.projectDir = base.projectDir
  if (!Array.isArray(next.start.command) || next.start.command.length === 0) {
    next.start.command = base.start.command
  }
  if (!Array.isArray(next.ports) || next.ports.length === 0) {
    next.ports = base.ports
  }
  return next
}

export function remapServicePorts(def: ServiceDefinition, newPorts: number[]): ServiceDefinition {
  const ports = newPorts.length > 0 ? newPorts : def.ports
  const openPort = ports[0]
  const healthPort = ports.length > 1 ? ports[ports.length - 1] : ports[0]
  const prevHealthPort = def.ports[def.ports.length > 1 ? def.ports.length - 1 : 0]
  let healthUrl = def.health.url
  if (prevHealthPort && healthUrl.includes(`:${prevHealthPort}`)) {
    healthUrl = healthUrl.replace(`:${prevHealthPort}`, `:${healthPort}`)
  } else {
    healthUrl = `http://localhost:${healthPort}/`
  }
  return {
    ...def,
    ports,
    openUrl: `http://localhost:${openPort}`,
    health: { ...def.health, url: healthUrl },
    stop: {
      ...(def.stop ?? {}),
      cleanupPorts: ports,
    },
  }
}

/**
 * Remap EVA ports AND try to make the process actually listen there
 * (PORT/VITE_PORT env + npm/pnpm/yarn/bun `-- --port`).
 */
export function applyListenPortOverride(
  def: ServiceDefinition,
  newPorts: number[]
): ServiceDefinition {
  let next = remapServicePorts(def, newPorts)
  const primary = next.ports[0]
  if (!primary) return next

  const env: Record<string, string> = {
    ...(next.start.env ?? {}),
    PORT: String(primary),
    VITE_PORT: String(primary),
  }

  let command = [...next.start.command]
  const runner = command[0]
  const isJsRunner =
    !!runner && ['npm', 'pnpm', 'yarn', 'bun', 'npx'].some((r) => runner === r || runner.endsWith(`/${r}`))
  const alreadyHasPortFlag = command.some((c, i) => c === '--port' || c === '-p' || (c === '--' && command[i + 1] === '--port'))
  if (isJsRunner && !alreadyHasPortFlag) {
    if (command.includes('--')) {
      command = [...command, '--port', String(primary)]
    } else {
      command = [...command, '--', '--port', String(primary)]
    }
  }

  next = {
    ...next,
    start: {
      ...next.start,
      command,
      env,
    },
  }
  return next
}

/** Shift every port by delta (default +10) for quick conflict escape. */
export function shiftPorts(def: ServiceDefinition, delta = 10): ServiceDefinition {
  return applyListenPortOverride(
    def,
    def.ports.map((p) => Math.min(65535, p + delta))
  )
}

interface ReviseResult {
  analysis: string
  definition: ServiceDefinition
}

async function reviseWithLlm(
  candidate: CandidateConfig,
  report: ProbeReport
): Promise<ReviseResult> {
  const ai = getActiveAiConfig()
  if (!ai) {
    throw new Error('未配置 AI，无法自动调整')
  }

  const system = `你是本地开发服务配置助手。根据试启动失败的日志与探测结果，先诊断再修订。
只输出一个 JSON 对象（不要 markdown），格式：
{
  "analysis": "用中文 1-3 句说明失败原因（引用日志关键线索）",
  "patch": { ...可修改字段 }
}
patch 允许字段：name, start.command, start.cwd, start.env, ports, health.url, health.acceptHttpCodes,
health.contains, health.fallbackUrls, openUrl, stop.graceSecs, stop.cleanupPorts。
禁止修改 id、projectDir。命令必须是字符串数组。端口必须是数字数组。
若端口冲突或进程未监听目标端口：必须改用其它端口，并在 start.command 或 start.env 里真正传入端口
（例如 npm run dev -- --port 3010，或 env PORT / VITE_PORT）。`

  const user = JSON.stringify(
    {
      recipe: candidate.recipe,
      evidence: candidate.evidence,
      warnings: candidate.warnings,
      current: candidate.definition,
      probe: {
        success: report.success,
        message: report.message,
        state: report.state,
        ports: report.ports,
        health: report.health,
        logTail: report.logTail?.slice(-6000) ?? null,
      },
    },
    null,
    2
  )

  const data = await window.api.ai.chatCompletion({
    baseUrl: ai.config.baseUrl,
    apiKey: ai.config.apiKey,
    model: ai.config.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.2,
    maxTokens: 1600,
  })

  const content =
    data?.choices?.[0]?.message?.content ??
    data?.choices?.[0]?.message?.reasoning_content ??
    ''
  if (!content || typeof content !== 'string') {
    throw new Error('AI 返回为空')
  }
  const parsed = extractJsonObject(content) as {
    analysis?: string
    patch?: Partial<ServiceDefinition>
    // allow model to return definition-shaped object at top level
    start?: ServiceDefinition['start']
    ports?: number[]
    health?: ServiceDefinition['health']
  }

  const analysis =
    typeof parsed.analysis === 'string' && parsed.analysis.trim()
      ? parsed.analysis.trim()
      : '已根据日志尝试修订配置（模型未给出明确诊断文案）。'

  let patch: Partial<ServiceDefinition>
  if (parsed.patch && typeof parsed.patch === 'object') {
    patch = parsed.patch
  } else {
    const { analysis: _a, ...rest } = parsed
    patch = rest as Partial<ServiceDefinition>
  }
  const definition = mergeDefinitionPatch(candidate.definition, patch)
  return { analysis, definition }
}

export async function pickProjectFolder(): Promise<string | null> {
  return window.api.services.pickFolder()
}

export async function scanProject(projectDir: string): Promise<CandidateConfig> {
  return window.api.services.scanProject(projectDir)
}

export async function probeCandidate(
  definition: ServiceDefinition,
  attempt: number
): Promise<ProbeReport> {
  return window.api.services.probeCandidate(definition, PROBE_TIMEOUT_SECS, attempt)
}

export async function commitService(definition: ServiceDefinition) {
  return window.api.services.upsert(definition)
}

export function createInitialSession(): SessionSnapshot {
  return {
    phase: 'idle',
    projectDir: '',
    candidate: null,
    report: null,
    attempt: 0,
    messages: [
      {
        id: mid('eva'),
        role: 'eva',
        at: Date.now(),
        kind: 'text',
        content:
          '把本地项目交给我来注册。选择目录后，我会分析项目、试启动，遇到端口冲突或失败时再请你决定。',
      },
    ],
    pendingDecision: null,
    busy: false,
    error: null,
    progress: null,
  }
}

function hasPortConflictWarning(candidate: CandidateConfig): boolean {
  return (candidate.warnings ?? []).some(
    (w) => w.includes('端口冲突') || w.includes('已有进程监听') || w.includes('已被')
  )
}

function isPortConflictReport(report: ProbeReport): boolean {
  return report.state === 'port_conflict' || report.message.includes('端口')
}

function decisionPortConflict(candidate: CandidateConfig): DecisionRequest {
  const ports = candidate.definition.ports.join(', ')
  const shifted = candidate.definition.ports.map((p) => p + 10).join(', ')
  return {
    id: mid('dec'),
    type: 'port_conflict',
    prompt: `端口 ${ports} 可能与其它服务冲突。你希望怎么处理？`,
    allowCustomPort: true,
    options: [
      {
        id: 'shift_10',
        label: `改用 ${shifted} 再试`,
        description: '每个端口 +10，并同步健康检查 URL',
        variant: 'default',
      },
      {
        id: 'probe_anyway',
        label: '仍用原端口试跑',
        description: '若已被占用会失败，但不会强杀其它服务',
        variant: 'outline',
      },
      ...(getActiveAiConfig()
        ? [
            {
              id: 'ai_pick_ports',
              label: '让 AI 选空闲端口',
              variant: 'secondary' as const,
            },
          ]
        : []),
      {
        id: 'abort',
        label: '取消',
        variant: 'destructive',
      },
    ],
  }
}

function decisionAfterScan(candidate: CandidateConfig): DecisionRequest {
  const cmd = candidate.definition.start.command.join(' ')
  const ports = candidate.definition.ports.join(', ')
  return {
    id: mid('dec'),
    type: 'after_scan',
    prompt: `建议配置：\`${cmd}\` · 端口 ${ports}。下一步？`,
    options: [
      { id: 'probe', label: '开始试跑', variant: 'default' },
      {
        id: 'shift_10',
        label: `先换端口 ${candidate.definition.ports.map((p) => p + 10).join(', ')}`,
        variant: 'outline',
      },
      { id: 'abort', label: '取消', variant: 'destructive' },
    ],
  }
}

function decisionProbeFailed(report: ProbeReport): DecisionRequest {
  const options: DecisionOption[] = []
  if (isPortConflictReport(report)) {
    options.push({
      id: 'shift_10',
      label: '端口 +10 后重试',
      variant: 'default',
    })
  }
  options.push({
    id: 'retry',
    label: '再试一次',
    variant: 'outline',
  })
  if (getActiveAiConfig()) {
    options.push({
      id: 'ai_revise',
      label: '再让 AI 读一次日志',
      variant: 'secondary',
    })
  }
  options.push(
    {
      id: 'commit_anyway',
      label: '仍要添加（跳过试跑）',
      variant: 'outline',
    },
    {
      id: 'abort',
      label: '取消',
      variant: 'destructive',
    }
  )
  return {
    id: mid('dec'),
    type: 'probe_failed',
    prompt: '还需要你拍板下一步：',
    allowCustomPort: true,
    options,
  }
}

function decisionConfirmCommit(): DecisionRequest {
  return {
    id: mid('dec'),
    type: 'confirm_commit',
    prompt: '试跑通过。要把这个服务写入本地服务列表吗？',
    options: [
      { id: 'commit', label: '确认添加', variant: 'default' },
      { id: 'abort', label: '先不添加', variant: 'outline' },
    ],
  }
}

function appendMessage(messages: ChatMessage[], msg: Omit<ChatMessage, 'id' | 'at'>): ChatMessage[] {
  return [...messages, { ...msg, id: mid(msg.role), at: Date.now() }]
}

function resolveDecisionMessage(
  messages: ChatMessage[],
  decisionId: string,
  choiceId: string,
  userLabel: string
): ChatMessage[] {
  return [
    ...messages.map((m) =>
      m.decision?.id === decisionId ? { ...m, resolvedChoiceId: choiceId } : m
    ),
    {
      id: mid('user'),
      role: 'user',
      at: Date.now(),
      kind: 'text',
      content: userLabel,
    },
  ]
}

export type SessionListener = (snap: SessionSnapshot) => void

/**
 * Imperative session controller for the chat UI.
 */
export class RegistrationSession {
  private snap: SessionSnapshot
  private listeners = new Set<SessionListener>()
  private cancelled = false
  private autoAiRevises = 0

  constructor() {
    this.snap = createInitialSession()
  }

  getSnapshot(): SessionSnapshot {
    return this.snap
  }

  subscribe(fn: SessionListener): () => void {
    this.listeners.add(fn)
    fn(this.snap)
    return () => this.listeners.delete(fn)
  }

  private emit(partial: Partial<SessionSnapshot>) {
    this.snap = { ...this.snap, ...partial }
    for (const fn of this.listeners) fn(this.snap)
  }

  private push(msg: Omit<ChatMessage, 'id' | 'at'>) {
    this.emit({ messages: appendMessage(this.snap.messages, msg) })
  }

  private beginProgress(progress: Omit<SessionProgress, 'startedAt'>) {
    this.emit({
      busy: true,
      progress: { ...progress, startedAt: Date.now() },
    })
  }

  private endProgress(extra?: Partial<SessionSnapshot>) {
    this.emit({ busy: false, progress: null, ...extra })
  }

  reset() {
    this.cancelled = true
    this.autoAiRevises = 0
    this.snap = createInitialSession()
    this.cancelled = false
    for (const fn of this.listeners) fn(this.snap)
  }

  async startWithDir(projectDir: string) {
    if (!projectDir.trim()) return
    this.cancelled = false
    this.autoAiRevises = 0
    this.emit({
      projectDir,
      busy: true,
      error: null,
      phase: 'scanning',
      candidate: null,
      report: null,
      attempt: 0,
      pendingDecision: null,
      progress: {
        kind: 'scan',
        label: '正在扫描项目',
        detail: '读取 package.json / Python / Compose 等信号…',
        startedAt: Date.now(),
        expectedMs: 8_000,
      },
      messages: appendMessage(createInitialSession().messages, {
        role: 'user',
        kind: 'text',
        content: `分析这个目录：\n\`${projectDir}\``,
      }),
    })

    this.push({
      role: 'eva',
      kind: 'text',
      content: '正在扫描项目文件（package.json / Python / Compose）…',
    })

    try {
      const candidate = await scanProject(projectDir)
      if (this.cancelled) return

      this.emit({ candidate, phase: 'awaiting_decision' })
      this.push({
        role: 'eva',
        kind: 'scan',
        content: `识别为 **${candidate.recipe || 'generic'}**（置信度 ${(candidate.confidence * 100).toFixed(0)}%）\n启动：\`${candidate.definition.start.command.join(' ')}\`\n端口：${candidate.definition.ports.join(', ')}\n健康检查：${candidate.definition.health.url}`,
        evidence: candidate.evidence,
        warnings: candidate.warnings,
        recipe: candidate.recipe,
        confidence: candidate.confidence,
      })

      const decision = hasPortConflictWarning(candidate)
        ? decisionPortConflict(candidate)
        : decisionAfterScan(candidate)

      this.emit({
        pendingDecision: decision,
        busy: false,
        progress: null,
        messages: appendMessage(this.snap.messages, {
          role: 'eva',
          kind: 'decision',
          content: decision.prompt,
          decision,
        }),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.emit({
        busy: false,
        progress: null,
        phase: 'failed',
        error: message,
      })
      this.push({ role: 'eva', kind: 'text', content: `分析失败：${message}` })
    }
  }

  async choose(optionId: string, optionLabel: string, customPorts?: number[]) {
    const decision = this.snap.pendingDecision
    if (!decision || this.snap.busy) return

    this.emit({
      pendingDecision: null,
      messages: resolveDecisionMessage(
        this.snap.messages,
        decision.id,
        optionId,
        optionLabel
      ),
    })

    if (optionId === 'abort') {
      this.push({ role: 'eva', kind: 'text', content: '已取消。你可以重新选择目录再来。' })
      this.emit({ phase: 'idle', busy: false, progress: null })
      return
    }

    let candidate = this.snap.candidate
    if (!candidate) return

    if (optionId === 'shift_10') {
      const nextDef = shiftPorts(candidate.definition, 10)
      candidate = {
        ...candidate,
        definition: nextDef,
        evidence: [...candidate.evidence, 'port-shift-+10'],
      }
      this.emit({ candidate })
      this.push({
        role: 'eva',
        kind: 'text',
        content: `已将监听端口改为 ${nextDef.ports.join(', ')}（命令：\`${nextDef.start.command.join(' ')}\`）\n健康检查 → ${nextDef.health.url}`,
      })
      await this.yieldAndProbe()
      return
    }

    if (optionId === 'custom_ports' && customPorts && customPorts.length > 0) {
      const nextDef = applyListenPortOverride(candidate.definition, customPorts)
      candidate = {
        ...candidate,
        definition: nextDef,
        evidence: [...candidate.evidence, 'custom-ports'],
      }
      this.emit({ candidate })
      this.push({
        role: 'eva',
        kind: 'text',
        content: `已使用自定义端口 ${nextDef.ports.join(', ')}（命令：\`${nextDef.start.command.join(' ')}\`）`,
      })
      await this.yieldAndProbe()
      return
    }

    if (optionId === 'ai_pick_ports' || optionId === 'ai_revise') {
      await this.runAiReviseAndProbe(
        this.snap.report ?? {
          success: false,
          message: decision.type === 'port_conflict' ? '端口冲突，请改用空闲端口' : '需要调整配置',
          state: decision.type === 'port_conflict' ? 'port_conflict' : 'unhealthy',
          health: 'unknown',
          ports: candidate.definition.ports.map((port) => ({ port, listening: false })),
          elapsedMs: 0,
          attempt: this.snap.attempt || 1,
        }
      )
      return
    }

    if (optionId === 'probe' || optionId === 'probe_anyway' || optionId === 'retry') {
      await this.yieldAndProbe()
      return
    }

    if (optionId === 'commit' || optionId === 'commit_anyway') {
      await this.commit()
      return
    }
  }

  private async yieldAndProbe() {
    await yieldToUi()
    await this.runProbe()
  }

  private async runProbe() {
    const candidate = this.snap.candidate
    if (!candidate) return
    const attempt = this.snap.attempt + 1
    this.emit({
      phase: 'probing',
      attempt,
      error: null,
      busy: true,
      progress: {
        kind: 'probe',
        label: `第 ${attempt} 次试启动`,
        detail: candidate.definition.start.command.join(' '),
        startedAt: Date.now(),
        expectedMs: PROBE_TIMEOUT_SECS * 1000,
      },
    })
    this.push({
      role: 'eva',
      kind: 'text',
      content: `第 ${attempt} 次试启动（最多约 ${PROBE_TIMEOUT_SECS}s）…\n命令：\`${candidate.definition.start.command.join(' ')}\``,
    })
    await yieldToUi()

    try {
      const report = await probeCandidate(candidate.definition, attempt)
      if (this.cancelled) return
      this.endProgress({ report })

      this.push({
        role: 'eva',
        kind: 'probe',
        content: report.success
          ? `试跑成功（${(report.elapsedMs / 1000).toFixed(1)}s）· health=${report.health}`
          : `试跑未通过（${(report.elapsedMs / 1000).toFixed(1)}s）：${report.message}`,
        report,
        collapsedLog: report.logTail ?? undefined,
      })

      if (report.success) {
        const decision = decisionConfirmCommit()
        this.emit({
          phase: 'ready',
          pendingDecision: decision,
          messages: appendMessage(this.snap.messages, {
            role: 'eva',
            kind: 'decision',
            content: decision.prompt,
            decision,
          }),
        })
        return
      }

      // Auto-analyze logs with AI instead of making the user dig through them.
      if (getActiveAiConfig() && this.autoAiRevises < MAX_AUTO_AI_REVISE) {
        this.push({
          role: 'eva',
          kind: 'text',
          content: '我先直接读试跑日志，用 AI 诊断并改配置，不用你自己翻。',
        })
        await this.runAiReviseAndProbe(report)
        return
      }

      if (!getActiveAiConfig()) {
        this.push({
          role: 'eva',
          kind: 'text',
          content: '未配置 AI，无法自动读日志。可在设置里配置后重试，或手动换端口。',
        })
      } else {
        this.push({
          role: 'eva',
          kind: 'text',
          content: '自动调整已达上限，请你选下一步。',
        })
      }

      const decision = decisionProbeFailed(report)
      this.emit({
        phase: 'awaiting_decision',
        pendingDecision: decision,
        messages: appendMessage(this.snap.messages, {
          role: 'eva',
          kind: 'decision',
          content: decision.prompt,
          decision,
        }),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.endProgress({ phase: 'failed', error: message })
      this.push({ role: 'eva', kind: 'text', content: `试跑异常：${message}` })
    }
  }

  private async runAiReviseAndProbe(report: ProbeReport) {
    const candidate = this.snap.candidate
    if (!candidate) return
    if (!getActiveAiConfig()) {
      this.push({ role: 'eva', kind: 'text', content: '未配置 AI，无法自动调整。请手动换端口或改配置。' })
      const decision = decisionProbeFailed(report)
      this.emit({
        phase: 'awaiting_decision',
        pendingDecision: decision,
        progress: null,
        busy: false,
        messages: appendMessage(this.snap.messages, {
          role: 'eva',
          kind: 'decision',
          content: decision.prompt,
          decision,
        }),
      })
      return
    }

    this.autoAiRevises += 1
    this.emit({
      phase: 'revising',
      busy: true,
      progress: {
        kind: 'ai',
        label: `AI 正在分析日志（${this.autoAiRevises}/${MAX_AUTO_AI_REVISE}）`,
        detail: '诊断失败原因并生成新的启动配置…',
        startedAt: Date.now(),
        expectedMs: 45_000,
      },
    })
    this.push({
      role: 'eva',
      kind: 'text',
      content: `正在分析日志并修订配置（第 ${this.autoAiRevises}/${MAX_AUTO_AI_REVISE} 次自动调整）…`,
    })
    await yieldToUi()

    try {
      const revised = await reviseWithLlm(candidate, report)
      if (this.cancelled) return
      const next: CandidateConfig = {
        ...candidate,
        definition: revised.definition,
        confidence: Math.max(0.35, candidate.confidence - 0.05),
        evidence: [...candidate.evidence, `llm-revise-${this.autoAiRevises}`],
      }
      this.emit({ candidate: next, progress: null })
      this.push({
        role: 'eva',
        kind: 'text',
        content: `**诊断：** ${revised.analysis}\n\n**新配置：** \`${revised.definition.start.command.join(' ')}\` · 端口 ${revised.definition.ports.join(', ')} · ${revised.definition.health.url}`,
      })
      await this.yieldAndProbe()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.endProgress({ phase: 'failed', error: message })
      this.push({ role: 'eva', kind: 'text', content: `AI 调整失败：${message}` })
      const decision = decisionProbeFailed(report)
      this.emit({
        phase: 'awaiting_decision',
        pendingDecision: decision,
        messages: appendMessage(this.snap.messages, {
          role: 'eva',
          kind: 'decision',
          content: decision.prompt,
          decision,
        }),
      })
    }
  }

  private async commit() {
    const candidate = this.snap.candidate
    if (!candidate) return
    this.beginProgress({
      kind: 'commit',
      label: '正在写入服务配置',
      detail: candidate.definition.name,
      expectedMs: 3_000,
    })
    try {
      const result = await commitService(candidate.definition)
      if (this.cancelled) return
      this.endProgress({ phase: 'committed', pendingDecision: null })
      this.push({
        role: 'eva',
        kind: 'text',
        content: `${result.message}。可在服务列表里启动它。`,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.endProgress({ error: message })
      this.push({ role: 'eva', kind: 'text', content: `写入失败：${message}` })
    }
  }
}

/** @deprecated kept for any old imports — prefer RegistrationSession */
export type LoopStatus = SessionPhase
export interface LoopState {
  status: SessionPhase
  candidate: CandidateConfig | null
  report: ProbeReport | null
  attempt: number
  message: string
}
