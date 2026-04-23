/**
 * AI Engine 设置向导组件
 * 引导用户完成 AI Engine 的初始化配置
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogFooter
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import {
    FolderOpen,
    CheckCircle,
    XCircle,
    Loader2,
    ChevronRight,
    ChevronLeft,
    Cpu,
    HardDrive,
    Terminal,
    Sparkles,
    AlertCircle,
    RefreshCcw,
    Play
} from 'lucide-react'

// 安装步骤
type SetupStep = 'welcome' | 'directory' | 'detect' | 'download' | 'install' | 'complete'

// 环境信息
interface EnvironmentInfo {
    pythonVersion: string | null
    pythonPath: string | null
    pipVersion: string | null
    gitVersion: string | null
    hasGpu: boolean
    gpuType: 'cuda' | 'mps' | 'none'
    diskSpace: number
    availablePythons: Array<{ path: string; version: string; recommended: boolean }>
}

interface AIEngineSetupWizardProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    onComplete?: () => void
    existingSource?: string // 从现有目录复制
}

export function AIEngineSetupWizard({
    open,
    onOpenChange,
    onComplete,
    existingSource
}: AIEngineSetupWizardProps): React.ReactElement {
    // 状态
    const [currentStep, setCurrentStep] = useState<SetupStep>('welcome')
    const [installPath, setInstallPath] = useState('')
    const [selectedPython, setSelectedPython] = useState<string>('')
    const [environment, setEnvironment] = useState<EnvironmentInfo | null>(null)
    const [progress, setProgress] = useState(0)
    const [progressMessage, setProgressMessage] = useState('')
    const [logs, setLogs] = useState<string[]>([])
    const [error, setError] = useState<string | null>(null)
    const [isLoading, setIsLoading] = useState(false)

    const logsEndRef = useRef<HTMLDivElement>(null)

    // 步骤配置
    const steps: { key: SetupStep; label: string; icon: React.ReactNode }[] = [
        { key: 'welcome', label: '欢迎', icon: <Sparkles className="h-4 w-4" /> },
        { key: 'directory', label: '安装目录', icon: <FolderOpen className="h-4 w-4" /> },
        { key: 'detect', label: '环境检测', icon: <Cpu className="h-4 w-4" /> },
        { key: 'download', label: '下载代码', icon: <HardDrive className="h-4 w-4" /> },
        { key: 'install', label: '安装依赖', icon: <Terminal className="h-4 w-4" /> },
        { key: 'complete', label: '完成', icon: <CheckCircle className="h-4 w-4" /> }
    ]

    const currentStepIndex = steps.findIndex(s => s.key === currentStep)

    // 初始化
    useEffect(() => {
        if (open) {
            loadDefaultPath()
            setupEventListeners()
        }
        return () => {
            removeEventListeners()
        }
    }, [open])

    // 自动滚动日志
    useEffect(() => {
        logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [logs])

    // 加载默认路径
    const loadDefaultPath = async () => {
        try {
            const defaultPath = await window.api.aiEngineGetDefaultPath()
            setInstallPath(defaultPath)
        } catch (err) {
            console.error('Failed to get default path:', err)
        }
    }

    // 设置事件监听
    const setupEventListeners = () => {
        const unsubProgress = window.api.onAIEngineProgress((p) => {
            setProgress(p.progress)
            setProgressMessage(p.message)
        })

        const unsubLog = window.api.onAIEngineLog((log) => {
            setLogs(prev => [...prev.slice(-100), log])
        })

        const unsubError = window.api.onAIEngineError((err) => {
            setError(err)
            setIsLoading(false)
        })

        const unsubComplete = window.api.onAIEngineComplete(() => {
            setCurrentStep('complete')
            setIsLoading(false)
        })

            // 存储清理函数
            ; (window as any).__aiEngineCleanup = () => {
                unsubProgress()
                unsubLog()
                unsubError()
                unsubComplete()
            }
    }

    const removeEventListeners = () => {
        if ((window as any).__aiEngineCleanup) {
            (window as any).__aiEngineCleanup()
            delete (window as any).__aiEngineCleanup
        }
    }

    // 选择目录
    const handleSelectDirectory = async () => {
        const path = await window.api.selectFolder()
        if (path) {
            // 自动追加 ai_engine 目录，避免污染基础目录
            const subDir = 'ai_engine'
            const finalPath = path.endsWith(subDir) || path.endsWith(subDir + '/')
                ? path
                : path.endsWith('/') ? `${path}${subDir}` : `${path}/${subDir}`
            setInstallPath(finalPath)
        }
    }

    // 下一步
    const handleNext = async () => {
        setError(null)
        setIsLoading(true)

        try {
            switch (currentStep) {
                case 'welcome':
                    setCurrentStep('directory')
                    setIsLoading(false)
                    break

                case 'directory':
                    const dirResult = await window.api.aiEngineSetInstallDirectory(installPath)
                    if (dirResult) {
                        setCurrentStep('detect')
                        // 自动开始环境检测
                        await handleDetectEnvironment()
                    }
                    break

                case 'detect':
                    setCurrentStep('download')
                    // 自动开始下载
                    await handleDownloadCode()
                    break

                case 'download':
                    setCurrentStep('install')
                    // 自动开始安装
                    await handleInstallDependencies()
                    break

                case 'install':
                    await window.api.aiEngineCompleteSetup()
                    setCurrentStep('complete')
                    break

                case 'complete':
                    onComplete?.()
                    onOpenChange(false)
                    break
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : '发生未知错误')
        } finally {
            setIsLoading(false)
        }
    }

    // 上一步
    const handleBack = () => {
        const prevIndex = currentStepIndex - 1
        if (prevIndex >= 0) {
            setCurrentStep(steps[prevIndex].key)
            setError(null)
        }
    }

    // 环境检测
    const handleDetectEnvironment = useCallback(async () => {
        setIsLoading(true)
        setLogs([])
        try {
            const env = await window.api.aiEngineDetectEnvironment()
            setEnvironment(env)
            if (env.pythonPath) {
                setSelectedPython(env.pythonPath)
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : '环境检测失败')
        } finally {
            setIsLoading(false)
        }
    }, [])

    // 下载代码
    const handleDownloadCode = useCallback(async () => {
        setIsLoading(true)
        setLogs([])
        setProgress(0)
        try {
            const result = await window.api.aiEngineDownloadCode(existingSource)
            if (!result) {
                throw new Error('代码下载失败')
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : '下载失败')
        } finally {
            setIsLoading(false)
        }
    }, [existingSource])

    // 安装依赖
    const handleInstallDependencies = useCallback(async () => {
        if (!selectedPython) {
            setError('请先选择 Python 环境')
            return
        }
        setIsLoading(true)
        setLogs([])
        setProgress(0)
        try {
            const result = await window.api.aiEngineInstallDependencies(selectedPython)
            if (!result) {
                throw new Error('依赖安装失败')
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : '安装失败')
        } finally {
            setIsLoading(false)
        }
    }, [selectedPython])

    // 渲染步骤指示器
    const renderStepIndicator = () => (
        <div className="flex items-center justify-center gap-2 mb-6">
            {steps.map((step, index) => (
                <div key={step.key} className="flex items-center">
                    <div
                        className={cn(
                            "flex items-center justify-center w-8 h-8 rounded-full border-2 transition-all",
                            index < currentStepIndex && "bg-emerald-500 border-emerald-500 text-white",
                            index === currentStepIndex && "bg-violet-500 border-violet-500 text-white",
                            index > currentStepIndex && "bg-zinc-100 border-zinc-300 text-zinc-400"
                        )}
                    >
                        {index < currentStepIndex ? (
                            <CheckCircle className="h-4 w-4" />
                        ) : (
                            step.icon
                        )}
                    </div>
                    {index < steps.length - 1 && (
                        <div
                            className={cn(
                                "w-8 h-0.5 mx-1",
                                index < currentStepIndex ? "bg-emerald-500" : "bg-zinc-200"
                            )}
                        />
                    )}
                </div>
            ))}
        </div>
    )

    // 渲染欢迎页
    const renderWelcome = () => (
        <div className="text-center py-8">
            <div className="mx-auto w-20 h-20 rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center mb-6 shadow-lg">
                <Cpu className="h-10 w-10 text-white" />
            </div>
            <h2 className="text-2xl font-semibold text-zinc-900 mb-3">设置 AI Engine</h2>
            <p className="text-zinc-500 mb-6 max-w-md mx-auto">
                EVA Core 是本地 AI 后端服务，提供知识库检索、AI 对话等功能。
                接下来将引导您完成初始化配置。
            </p>
            <div className="grid grid-cols-3 gap-4 max-w-lg mx-auto text-left">
                <Card className="bg-zinc-50 border-zinc-200">
                    <CardContent className="p-4 text-center">
                        <Sparkles className="h-6 w-6 text-violet-500 mx-auto mb-2" />
                        <p className="text-sm font-medium text-zinc-700">RAG 检索</p>
                    </CardContent>
                </Card>
                <Card className="bg-zinc-50 border-zinc-200">
                    <CardContent className="p-4 text-center">
                        <Terminal className="h-6 w-6 text-indigo-500 mx-auto mb-2" />
                        <p className="text-sm font-medium text-zinc-700">本地运行</p>
                    </CardContent>
                </Card>
                <Card className="bg-zinc-50 border-zinc-200">
                    <CardContent className="p-4 text-center">
                        <HardDrive className="h-6 w-6 text-emerald-500 mx-auto mb-2" />
                        <p className="text-sm font-medium text-zinc-700">GPU 加速</p>
                    </CardContent>
                </Card>
            </div>
        </div>
    )

    // 渲染目录选择
    const renderDirectory = () => (
        <div className="py-4">
            <h2 className="text-lg font-semibold text-zinc-900 mb-2">选择安装目录</h2>
            <p className="text-sm text-zinc-500 mb-6">
                请选择 AI Engine 的安装位置。建议使用默认路径，除非有特殊需求。
            </p>
            <div className="space-y-4">
                <div className="flex gap-2">
                    <Input
                        value={installPath}
                        onChange={(e) => setInstallPath(e.target.value)}
                        placeholder="选择安装目录"
                        className="font-mono text-sm"
                    />
                    <Button variant="outline" onClick={handleSelectDirectory}>
                        <FolderOpen className="h-4 w-4" />
                    </Button>
                </div>
                <div className="p-4 rounded-lg bg-amber-50 border border-amber-200">
                    <div className="flex items-start gap-2">
                        <AlertCircle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                        <div>
                            <p className="text-sm font-medium text-amber-800">磁盘空间提示</p>
                            <p className="text-xs text-amber-700 mt-1">
                                安装需要约 2-3GB 磁盘空间（包含 Python 依赖和模型文件）
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )

    // 渲染环境检测
    const renderDetect = () => (
        <div className="py-4">
            <h2 className="text-lg font-semibold text-zinc-900 mb-2">环境检测</h2>
            <p className="text-sm text-zinc-500 mb-6">
                正在检测您的系统环境...
            </p>

            {isLoading && !environment ? (
                <div className="flex flex-col items-center py-8">
                    <Loader2 className="h-8 w-8 text-violet-500 animate-spin mb-4" />
                    <p className="text-sm text-zinc-500">正在检测...</p>
                </div>
            ) : environment ? (
                <div className="space-y-4">
                    {/* 检测结果 */}
                    <div className="space-y-3">
                        <div className="flex items-center gap-3 p-3 rounded-lg bg-zinc-50 border border-zinc-200">
                            {environment.pythonVersion ? (
                                <CheckCircle className="h-5 w-5 text-emerald-500" />
                            ) : (
                                <XCircle className="h-5 w-5 text-red-500" />
                            )}
                            <div className="flex-1">
                                <p className="text-sm font-medium text-zinc-700">Python</p>
                                <p className="text-xs text-zinc-500">
                                    {environment.pythonVersion || '未检测到'}
                                </p>
                            </div>
                        </div>

                        <div className="flex items-center gap-3 p-3 rounded-lg bg-zinc-50 border border-zinc-200">
                            {environment.pipVersion ? (
                                <CheckCircle className="h-5 w-5 text-emerald-500" />
                            ) : (
                                <XCircle className="h-5 w-5 text-red-500" />
                            )}
                            <div className="flex-1">
                                <p className="text-sm font-medium text-zinc-700">pip</p>
                                <p className="text-xs text-zinc-500">
                                    {environment.pipVersion ? `版本 ${environment.pipVersion}` : '未检测到'}
                                </p>
                            </div>
                        </div>

                        <div className="flex items-center gap-3 p-3 rounded-lg bg-zinc-50 border border-zinc-200">
                            {environment.hasGpu ? (
                                <CheckCircle className="h-5 w-5 text-emerald-500" />
                            ) : (
                                <AlertCircle className="h-5 w-5 text-amber-500" />
                            )}
                            <div className="flex-1">
                                <p className="text-sm font-medium text-zinc-700">GPU 加速</p>
                                <p className="text-xs text-zinc-500">
                                    {environment.gpuType === 'mps' ? 'Apple Silicon MPS' :
                                        environment.gpuType === 'cuda' ? 'NVIDIA CUDA' : '仅 CPU（速度较慢）'}
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Python 选择 */}
                    {environment.availablePythons.length > 1 && (
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-zinc-700">选择 Python 版本</label>
                            <div className="space-y-2">
                                {environment.availablePythons.map((py) => (
                                    <button
                                        key={py.path}
                                        onClick={() => setSelectedPython(py.path)}
                                        className={cn(
                                            "w-full flex items-center gap-3 p-3 rounded-lg border transition-all text-left",
                                            selectedPython === py.path
                                                ? "border-violet-500 bg-violet-50"
                                                : "border-zinc-200 hover:border-zinc-300"
                                        )}
                                    >
                                        <div className={cn(
                                            "w-4 h-4 rounded-full border-2",
                                            selectedPython === py.path
                                                ? "border-violet-500 bg-violet-500"
                                                : "border-zinc-300"
                                        )}>
                                            {selectedPython === py.path && (
                                                <div className="w-full h-full flex items-center justify-center">
                                                    <div className="w-1.5 h-1.5 rounded-full bg-white" />
                                                </div>
                                            )}
                                        </div>
                                        <div className="flex-1">
                                            <p className="text-sm font-medium text-zinc-700">
                                                Python {py.version}
                                                {py.recommended && (
                                                    <span className="ml-2 text-xs text-emerald-600">推荐</span>
                                                )}
                                            </p>
                                            <p className="text-xs text-zinc-500 font-mono">{py.path}</p>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            ) : null}

            <div className="mt-4">
                <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDetectEnvironment}
                    disabled={isLoading}
                    className="gap-2"
                >
                    <RefreshCcw className={cn("h-4 w-4", isLoading && "animate-spin")} />
                    重新检测
                </Button>
            </div>
        </div>
    )

    // 渲染下载/安装进度
    const renderProgress = (title: string) => (
        <div className="py-4">
            <h2 className="text-lg font-semibold text-zinc-900 mb-2">{title}</h2>
            <p className="text-sm text-zinc-500 mb-6">{progressMessage || '请稍候...'}</p>

            <div className="space-y-4">
                <Progress value={progress} className="h-2" />
                <p className="text-sm text-zinc-500 text-center">{progress}%</p>

                {/* 日志区域 */}
                <div className="h-48 overflow-auto rounded-lg bg-zinc-950 p-4 font-mono text-xs">
                    {logs.length === 0 ? (
                        <p className="text-zinc-600">等待输出...</p>
                    ) : (
                        logs.map((log, i) => (
                            <div key={i} className="text-zinc-400">{log}</div>
                        ))
                    )}
                    <div ref={logsEndRef} />
                </div>
            </div>
        </div>
    )

    // 渲染完成页
    const renderComplete = () => (
        <div className="text-center py-8">
            <div className="mx-auto w-20 h-20 rounded-full bg-emerald-100 flex items-center justify-center mb-6">
                <CheckCircle className="h-10 w-10 text-emerald-500" />
            </div>
            <h2 className="text-2xl font-semibold text-zinc-900 mb-3">设置完成！</h2>
            <p className="text-zinc-500 mb-6">
                AI Engine 已成功安装并配置完成。您现在可以开始使用了。
            </p>
            <Button onClick={() => { onComplete?.(); onOpenChange(false) }} className="gap-2">
                <Play className="h-4 w-4" />
                开始使用
            </Button>
        </div>
    )

    // 渲染当前步骤内容
    const renderStepContent = () => {
        switch (currentStep) {
            case 'welcome':
                return renderWelcome()
            case 'directory':
                return renderDirectory()
            case 'detect':
                return renderDetect()
            case 'download':
                return renderProgress('下载代码')
            case 'install':
                return renderProgress('安装依赖')
            case 'complete':
                return renderComplete()
            default:
                return null
        }
    }

    // 判断是否可以下一步
    const canProceed = () => {
        if (isLoading) return false
        switch (currentStep) {
            case 'directory':
                return !!installPath
            case 'detect':
                return !!environment?.pythonPath
            default:
                return true
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Cpu className="h-5 w-5 text-violet-500" />
                        AI Engine 设置向导
                    </DialogTitle>
                    <DialogDescription>
                        按照向导完成 AI Engine 的初始化配置
                    </DialogDescription>
                </DialogHeader>

                {/* 步骤指示器 */}
                {renderStepIndicator()}

                {/* 错误提示 */}
                {error && (
                    <div className="p-4 rounded-lg bg-red-50 border border-red-200 mb-4">
                        <div className="flex items-start gap-2">
                            <XCircle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
                            <div>
                                <p className="text-sm font-medium text-red-800">错误</p>
                                <p className="text-xs text-red-700 mt-1">{error}</p>
                            </div>
                        </div>
                    </div>
                )}

                {/* 步骤内容区域 - 添加滚动支持 */}
                <div className="flex-1 overflow-y-auto px-1 py-4 max-h-[50vh] min-h-[300px] scrollbar-thin">
                    {renderStepContent()}
                </div>

                {/* 导航按钮区域 */}
                <DialogFooter className="flex items-center justify-between border-t pt-4 mt-2">
                    <div className="flex gap-2">
                        {currentStep !== 'welcome' && currentStep !== 'complete' && (
                            <Button
                                variant="outline"
                                onClick={handleBack}
                                disabled={isLoading}
                                className="gap-2"
                            >
                                <ChevronLeft className="h-4 w-4" />
                                上一步
                            </Button>
                        )}
                    </div>
                    <div className="flex gap-2">
                        {currentStep !== 'complete' ? (
                            <Button
                                onClick={handleNext}
                                disabled={!canProceed() || isLoading}
                                className="min-w-[100px] gap-2"
                            >
                                {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                                {currentStep === 'install' ? '完成' : '下一步'}
                                {!isLoading && <ChevronRight className="h-4 w-4" />}
                            </Button>
                        ) : null}
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
