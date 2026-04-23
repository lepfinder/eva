import { useState } from 'react'
import {
    Plus,
    Loader2,
    BookOpen,
    FileText,
    Clock,
    Trash2,
    FolderOpen
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { KnowledgeBase, KnowledgeBaseType } from '../../hooks/useKnowledgeBases'

interface KnowledgeBaseSettingsProps {
    knowledgeBases: KnowledgeBase[]
    onAddKB: (name: string, type: KnowledgeBaseType, path: string, excludePaths?: string[]) => Promise<void>
    onDeleteKB: (id: string) => Promise<void>
    onBuildIndex: (id: string) => Promise<boolean>
}

export function KnowledgeBaseSettings({
    knowledgeBases,
    onAddKB,
    onDeleteKB,
    onBuildIndex
}: KnowledgeBaseSettingsProps) {
    const [showAddDialog, setShowAddDialog] = useState(false)
    const [newKBName, setNewKBName] = useState('')
    const [newKBType, setNewKBType] = useState<KnowledgeBaseType>('obsidian')
    const [newKBPath, setNewKBPath] = useState('')
    const [newKBExcludePaths, setNewKBExcludePaths] = useState<string[]>([])

    const handleSelectNewKBPath = async () => {
        const path = await window.api.openDirectory()
        if (path) {
            setNewKBPath(path)
            if (!newKBName) {
                const folderName = path.split(/[/\\]/).pop()
                if (folderName) setNewKBName(folderName)
            }
        }
    }

    const handleAddExcludePath = async () => {
        const path = await window.api.openDirectory()
        if (path && !newKBExcludePaths.includes(path)) {
            setNewKBExcludePaths([...newKBExcludePaths, path])
        }
    }

    const handleRemoveExcludePath = (path: string) => {
        setNewKBExcludePaths(newKBExcludePaths.filter((p) => p !== path))
    }

    const handleAddKB = async () => {
        if (!newKBName || !newKBPath) return

        await onAddKB(newKBName, newKBType, newKBPath, newKBExcludePaths)
        setShowAddDialog(false)
        setNewKBName('')
        setNewKBPath('')
        setNewKBType('obsidian')
        setNewKBExcludePaths([])
    }

    return (
        <div className="relative h-full">
            {/* 知识库列表区域 */}
            <div className="space-y-4 py-4 h-[500px] overflow-y-auto pr-2">
                <div className="flex items-center justify-between mb-2">
                    <div className="text-sm text-muted-foreground">
                        管理本地知识库，构建索引以支持 RAG
                    </div>
                    <Button size="sm" onClick={() => setShowAddDialog(true)}>
                        <Plus className="h-4 w-4 mr-1" />
                        添加
                    </Button>
                </div>

                {knowledgeBases.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground border rounded-lg border-dashed">
                        <BookOpen className="h-8 w-8 mx-auto mb-2 opacity-50" />
                        <p>还没有添加任何知识库</p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {knowledgeBases.map((kb) => (
                            <div
                                key={kb.id}
                                className="p-4 rounded-lg border bg-card/50 hover:bg-card transition-colors flex items-center justify-between gap-6"
                            >
                                <div className="flex items-start gap-4 flex-1 min-w-0">
                                    <div className="text-2xl mt-0.5 shrink-0">
                                        {kb.type === 'obsidian' ? '📝' : kb.type === 'pdf' ? '📄' : '💻'}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="font-semibold flex items-center gap-2 mb-1">
                                            {kb.name}
                                            {kb.status === 'indexed' && (
                                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20">
                                                    已索引
                                                </span>
                                            )}
                                            {kb.status === 'indexing' && (
                                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center gap-1 border border-blue-500/20">
                                                    <Loader2 className="h-3 w-3 animate-spin" />
                                                    索引中
                                                </span>
                                            )}
                                            {kb.status === 'error' && (
                                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20">
                                                    错误
                                                </span>
                                            )}
                                        </div>
                                        <div className="text-xs text-muted-foreground break-all opacity-80" title={kb.path}>
                                            {kb.path}
                                        </div>
                                        {kb.status === 'indexed' && (
                                            <div className="text-[11px] text-muted-foreground mt-1.5 flex items-center gap-4">
                                                {kb.docCount > 0 && (
                                                    <div className="flex items-center gap-1.5">
                                                        <FileText className="h-3 w-3" />
                                                        {kb.docCount} 篇文档
                                                    </div>
                                                )}
                                                {kb.lastIndexedAt && (
                                                    <div className="flex items-center gap-1.5">
                                                        <Clock className="h-3 w-3" />
                                                        上次索引: {new Date(kb.lastIndexedAt).toLocaleString()}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                        {kb.errorMessage && (
                                            <div className="text-xs text-red-500 mt-1">{kb.errorMessage}</div>
                                        )}
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-8 text-xs px-3"
                                        onClick={() => onBuildIndex(kb.id)}
                                        disabled={kb.status === 'indexing'}
                                    >
                                        {kb.status === 'indexing' ? (
                                            <><Loader2 className="h-3 w-3 animate-spin mr-1.5" />索引中</>
                                        ) : kb.status === 'indexed' ? (
                                            '更新索引'
                                        ) : (
                                            '构建索引'
                                        )}
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                                        onClick={() => onDeleteKB(kb.id)}
                                        title="删除知识库"
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* 添加知识库嵌套对话框 (overlay) */}
            {showAddDialog && (
                <div className="absolute inset-0 z-50 bg-background/95 backdrop-blur-sm flex items-center justify-center p-4 rounded-lg border border-border mt-14 mb-[calc(100%-100px)]">
                    {/* Hacky styling to position overlay inside the Dialog wrapper if we want. 
                        Actually, placing it absolute inset-0 works relative to `relative h-full` container.
                     */}

                    <div className="bg-background rounded-lg shadow-lg border w-full max-w-md p-6 space-y-4 animate-in fade-in zoom-in duration-200">
                        <h3 className="text-lg font-semibold">添加知识库</h3>

                        <div className="space-y-3">
                            <div className="space-y-2">
                                <Label>名称</Label>
                                <Input
                                    placeholder="例如：我的 Obsidian 笔记"
                                    value={newKBName}
                                    onChange={(e) => setNewKBName(e.target.value)}
                                />
                            </div>

                            <div className="space-y-2">
                                <Label>类型</Label>
                                <div className="grid grid-cols-3 gap-2">
                                    {(['obsidian', 'pdf', 'code'] as const).map((type) => (
                                        <button
                                            key={type}
                                            onClick={() => setNewKBType(type)}
                                            className={`p-2 rounded-lg border text-center transition-colors ${newKBType === type
                                                ? 'border-primary bg-primary/10'
                                                : 'hover:bg-muted'
                                                }`}
                                        >
                                            <div className="text-xl mb-1">
                                                {type === 'obsidian' ? '📝' : type === 'pdf' ? '📄' : '💻'}
                                            </div>
                                            <div className="text-xs font-medium">
                                                {type === 'obsidian' ? 'Obsidian' : type === 'pdf' ? 'PDF' : '代码'}
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label>路径</Label>
                                <div className="flex gap-2">
                                    <Input
                                        className="font-mono text-xs"
                                        placeholder="选择文件夹路径"
                                        value={newKBPath}
                                        onChange={(e) => setNewKBPath(e.target.value)}
                                    />
                                    <Button variant="outline" size="icon" onClick={handleSelectNewKBPath}>
                                        <FolderOpen className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <Label>排除目录（可选）</Label>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-6 px-2 text-xs"
                                        onClick={handleAddExcludePath}
                                    >
                                        <Plus className="h-3 w-3 mr-1" />
                                        添加
                                    </Button>
                                </div>
                                {newKBExcludePaths.length > 0 ? (
                                    <div className="space-y-1">
                                        {newKBExcludePaths.map((path, index) => (
                                            <div
                                                key={index}
                                                className="flex items-center gap-2 px-2 py-1.5 rounded bg-muted/50 text-xs font-mono"
                                            >
                                                <span className="flex-1 truncate" title={path}>{path}</span>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-5 w-5 shrink-0 text-muted-foreground hover:text-destructive"
                                                    onClick={() => handleRemoveExcludePath(path)}
                                                >
                                                    <Trash2 className="h-3 w-3" />
                                                </Button>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="text-xs text-muted-foreground">
                                        索引时将跳过这些目录
                                    </p>
                                )}
                            </div>
                        </div>

                        <div className="flex justify-end gap-2 pt-2">
                            <Button variant="outline" onClick={() => setShowAddDialog(false)}>
                                取消
                            </Button>
                            <Button
                                onClick={handleAddKB}
                                disabled={!newKBName || !newKBPath}
                            >
                                添加
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div >
    )
}
