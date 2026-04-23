import React from 'react'
import {
    FolderOpen, Download, CheckCircle, XCircle, Loader2, Search, RotateCcw, AlertCircle
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { TabsContent } from '@/components/ui/tabs'
import type { PythonServiceInfo } from '@/hooks/usePythonService'
import type { AIEngineConfig } from '../types'

interface ManualValidation {
    valid: boolean
    error?: string
    hasVenv: boolean
    hasPython: boolean
}

interface SettingsTabProps {
    aiEngineConfig: AIEngineConfig | null
    manualPath: string
    manualValidation: ManualValidation | null
    isValidating: boolean
    serviceInfo: PythonServiceInfo | null
    onSetManualPath: (v: string) => void
    onSetManualValidation: (v: ManualValidation | null) => void
    onValidatePath: () => void
    onSaveConfig: () => void
    onResetConfig: () => void
    onShowSetupWizard: () => void
}

export function SettingsTab({
    aiEngineConfig,
    manualPath,
    manualValidation,
    isValidating,
    serviceInfo,
    onSetManualPath,
    onSetManualValidation,
    onValidatePath,
    onSaveConfig,
    onResetConfig,
    onShowSetupWizard
}: SettingsTabProps) {
    return (
        <TabsContent value="settings" className="flex-1 overflow-auto mt-0 scrollbar-thin">
            <div className="px-6 pb-6 space-y-5 animation-fade-in">
                {/* 配置模式选择（未初始化时） */}
                {!aiEngineConfig?.initialized && (
                    <Card className="bg-white border-zinc-200 shadow-sm">
                        <CardHeader>
                            <CardTitle className="text-base font-medium text-zinc-900">配置模式</CardTitle>
                            <CardDescription className="text-sm text-zinc-500">选择适合您的配置方式</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <button
                                    onClick={() => {/* 手动配置 */}}
                                    className="p-6 rounded-lg border-2 border-violet-200 bg-violet-50 hover:border-violet-400 transition-all text-left"
                                >
                                    <div className="flex items-center gap-3 mb-3">
                                        <div className="p-2 rounded-lg bg-violet-100">
                                            <FolderOpen className="h-5 w-5 text-violet-600" />
                                        </div>
                                        <span className="text-sm font-semibold text-violet-900">手动配置</span>
                                    </div>
                                    <p className="text-xs text-violet-700">已有本地 AI Engine 环境？直接指定目录路径即可使用。</p>
                                </button>
                                <button
                                    onClick={onShowSetupWizard}
                                    className="p-6 rounded-lg border-2 border-emerald-200 bg-emerald-50 hover:border-emerald-400 transition-all text-left"
                                >
                                    <div className="flex items-center gap-3 mb-3">
                                        <div className="p-2 rounded-lg bg-emerald-100">
                                            <Download className="h-5 w-5 text-emerald-600" />
                                        </div>
                                        <span className="text-sm font-semibold text-emerald-900">自动安装</span>
                                    </div>
                                    <p className="text-xs text-emerald-700">首次使用？向导将自动下载代码、检测环境并安装依赖。</p>
                                </button>
                            </div>
                        </CardContent>
                    </Card>
                )}

                {/* 手动配置表单（未初始化时） */}
                {!aiEngineConfig?.initialized && (
                    <Card className="bg-white border-zinc-200 shadow-sm">
                        <CardHeader>
                            <CardTitle className="text-base font-medium text-zinc-900 flex items-center gap-2">
                                <FolderOpen className="h-4 w-4 text-violet-500" />
                                手动配置
                            </CardTitle>
                            <CardDescription className="text-sm text-zinc-500">指定现有 AI Engine 目录路径</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="flex gap-2">
                                <Input
                                    value={manualPath}
                                    onChange={(e) => {
                                        onSetManualPath(e.target.value)
                                        onSetManualValidation(null)
                                    }}
                                    placeholder="请输入 AI Engine 目录路径"
                                    className="font-mono text-sm"
                                />
                                <Button
                                    variant="outline"
                                    onClick={async () => {
                                        const path = await window.api.selectFolder()
                                        if (path) {
                                            onSetManualPath(path)
                                            onSetManualValidation(null)
                                        }
                                    }}
                                >
                                    <FolderOpen className="h-4 w-4" />
                                </Button>
                            </div>

                            {/* 验证结果 */}
                            {manualValidation && (
                                <div className={`p-4 rounded-lg border ${manualValidation.valid
                                    ? 'bg-emerald-50 border-emerald-200'
                                    : 'bg-red-50 border-red-200'
                                }`}>
                                    {manualValidation.valid ? (
                                        <div className="space-y-2">
                                            <div className="flex items-center gap-2">
                                                <CheckCircle className="h-4 w-4 text-emerald-500" />
                                                <span className="text-sm font-medium text-emerald-700">目录验证通过</span>
                                            </div>
                                            <div className="text-xs text-emerald-600 space-y-1">
                                                <p>✓ 找到 main.py 和 requirements.txt</p>
                                                <p>{manualValidation.hasVenv ? '✓ 找到虚拟环境 (venv)' : '⚠ 未找到虚拟环境，需要手动安装依赖'}</p>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex items-center gap-2">
                                            <XCircle className="h-4 w-4 text-red-500" />
                                            <span className="text-sm font-medium text-red-700">{manualValidation.error}</span>
                                        </div>
                                    )}
                                </div>
                            )}

                            <div className="flex gap-2">
                                <Button
                                    variant="outline"
                                    onClick={onValidatePath}
                                    disabled={!manualPath || isValidating}
                                    className="gap-2"
                                >
                                    {isValidating ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                        <Search className="h-4 w-4" />
                                    )}
                                    验证目录
                                </Button>
                                <Button
                                    onClick={onSaveConfig}
                                    disabled={!manualValidation?.valid}
                                    className="gap-2"
                                >
                                    <CheckCircle className="h-4 w-4" />
                                    保存配置
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                )}

                {/* 当前配置（已初始化时） */}
                {aiEngineConfig?.initialized && (
                    <Card className="bg-white border-zinc-200 shadow-sm">
                        <CardHeader>
                            <CardTitle className="text-base font-medium text-zinc-900">当前配置</CardTitle>
                            <CardDescription className="text-sm text-zinc-500">
                                {aiEngineConfig.setupMode === 'manual' ? '手动配置模式' : '自动安装模式'}
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="p-4 rounded-lg bg-zinc-50 border border-zinc-200">
                                    <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1">安装状态</p>
                                    <div className="flex items-center gap-2">
                                        <CheckCircle className="h-4 w-4 text-emerald-500" />
                                        <span className="text-sm font-medium text-emerald-700">已配置</span>
                                    </div>
                                </div>
                                <div className="p-4 rounded-lg bg-zinc-50 border border-zinc-200">
                                    <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1">配置模式</p>
                                    <p className="text-sm font-medium text-zinc-900">
                                        {aiEngineConfig.setupMode === 'manual' ? '手动配置' : '自动安装'}
                                    </p>
                                </div>
                            </div>
                            <Separator className="bg-zinc-100" />
                            <div className="space-y-3">
                                {[
                                    { label: '安装路径', value: aiEngineConfig.installPath },
                                    { label: 'Python 路径', value: aiEngineConfig.pythonPath || '未指定' },
                                    { label: '配置时间', value: aiEngineConfig.installedAt ? new Date(aiEngineConfig.installedAt).toLocaleString('zh-CN') : '未知' },
                                    { label: '服务端口', value: String(serviceInfo?.port || '18888') },
                                    { label: '代码来源', value: aiEngineConfig.codeSource === 'bundled' ? '内置源' : aiEngineConfig.codeSource === 'github' ? 'GitHub' : '本地目录' }
                                ].map(item => (
                                    <div key={item.label} className="flex items-center justify-between">
                                        <span className="text-sm text-zinc-500">{item.label}</span>
                                        <span className="text-sm font-mono text-zinc-700">{item.value}</span>
                                    </div>
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                )}

                {/* 操作区域（已初始化时） */}
                {aiEngineConfig?.initialized && (
                    <Card className="bg-white border-zinc-200 shadow-sm">
                        <CardHeader>
                            <CardTitle className="text-base font-medium text-zinc-900">操作</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="flex items-center justify-between p-4 rounded-lg bg-zinc-50 border border-zinc-200">
                                <div>
                                    <p className="text-sm font-medium text-zinc-900">重新配置</p>
                                    <p className="text-xs text-zinc-500 mt-0.5">清除当前配置，重新选择配置模式</p>
                                </div>
                                <Button
                                    variant="outline"
                                    onClick={onResetConfig}
                                    className="gap-2 border-red-200 text-red-600 hover:bg-red-50"
                                >
                                    <RotateCcw className="h-4 w-4" />
                                    重置
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                )}

                {/* 说明 */}
                <Card className="bg-amber-50 border-amber-200">
                    <CardContent className="p-4">
                        <div className="flex items-start gap-3">
                            <AlertCircle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                            <div>
                                <p className="text-sm font-medium text-amber-900">关于 AI Engine</p>
                                <p className="text-xs text-amber-700 mt-1">
                                    EVA Core 是本地 AI 后端服务，提供知识库检索、AI 对话等功能。
                                    您可以选择手动配置现有环境，或使用向导自动安装。
                                </p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </TabsContent>
    )
}
