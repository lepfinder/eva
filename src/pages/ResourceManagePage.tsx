/**
 * 资源管理页面组件
 */
import { useState, useEffect, useCallback } from 'react'
import {
    ArrowLeft,
    Trash2,
    Search,
    Upload,
    Copy,
    Check,
    Image as ImageIcon,
    Loader2
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'

interface IconItem {
    name: string
    size: number
    modifiedTime: number
    imageData?: string
}

interface ResourceManagePageProps {
    onBack: () => void
}

export function ResourceManagePage({
    onBack
}: ResourceManagePageProps): React.ReactElement {
    const [loading, setLoading] = useState(true)
    const [icons, setIcons] = useState<IconItem[]>([])
    const [searchQuery, setSearchQuery] = useState('')
    const [selectedIcons, setSelectedIcons] = useState<Set<string>>(new Set())
    const [copiedIcon, setCopiedIcon] = useState<string | null>(null)
    const [deleting, setDeleting] = useState(false)

    // 加载图标列表
    const loadIcons = useCallback(async () => {
        setLoading(true)
        try {
            const list = await window.api.getIconList()
            // 加载每个图标的 base64 数据
            const iconsWithData: IconItem[] = await Promise.all(
                list.map(async (item) => {
                    const imageData = await window.api.getNavIconData(item.name)
                    return { ...item, imageData: imageData || undefined }
                })
            )
            setIcons(iconsWithData)
        } catch (err) {
            console.error('加载图标失败:', err)
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        loadIcons()
    }, [loadIcons])

    // 过滤图标
    const filteredIcons = icons.filter((icon) =>
        icon.name.toLowerCase().includes(searchQuery.toLowerCase())
    )

    // 全选/取消全选
    const toggleSelectAll = () => {
        if (selectedIcons.size === filteredIcons.length) {
            setSelectedIcons(new Set())
        } else {
            setSelectedIcons(new Set(filteredIcons.map((i) => i.name)))
        }
    }

    // 切换选中状态
    const toggleSelect = (name: string) => {
        const newSelected = new Set(selectedIcons)
        if (newSelected.has(name)) {
            newSelected.delete(name)
        } else {
            newSelected.add(name)
        }
        setSelectedIcons(newSelected)
    }

    // 复制文件名
    const copyFileName = async (name: string) => {
        try {
            await navigator.clipboard.writeText(name)
            setCopiedIcon(name)
            setTimeout(() => setCopiedIcon(null), 2000)
        } catch (err) {
            console.error('复制失败:', err)
        }
    }

    // 删除选中的图标
    const handleDeleteSelected = async () => {
        if (selectedIcons.size === 0) return
        if (!confirm(`确定要删除选中的 ${selectedIcons.size} 个图标吗？`)) return

        setDeleting(true)
        try {
            const result = await window.api.deleteIcons(Array.from(selectedIcons))
            if (result.deleted > 0) {
                setSelectedIcons(new Set())
                await loadIcons()
            }
            if (result.errors.length > 0) {
                console.error('部分删除失败:', result.errors)
            }
        } catch (err) {
            console.error('删除失败:', err)
        } finally {
            setDeleting(false)
        }
    }

    return (
        <div className="h-full flex flex-col">
            {/* 顶部栏 */}
            <div className="shrink-0 pb-4 flex items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" size="icon" onClick={onBack}>
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                    <h2 className="text-xl font-semibold">资源管理</h2>
                </div>

                <Button disabled>
                    <Upload className="mr-2 h-4 w-4" />
                    上传资源
                </Button>
            </div>

            {/* 搜索和操作 */}
            <div className="shrink-0 pb-4 flex gap-4 items-center">
                <div className="relative w-64">
                    <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                        <Search className="h-4 w-4 text-muted-foreground" />
                    </span>
                    <Input
                        placeholder="搜索资源..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-9"
                    />
                </div>

                <div className="flex items-center gap-2">
                    <Checkbox
                        id="select-all"
                        checked={filteredIcons.length > 0 && selectedIcons.size === filteredIcons.length}
                        onCheckedChange={toggleSelectAll}
                    />
                    <label htmlFor="select-all" className="text-sm cursor-pointer">
                        全选 ({selectedIcons.size}/{filteredIcons.length})
                    </label>
                </div>

                {selectedIcons.size > 0 && (
                    <Button
                        variant="destructive"
                        size="sm"
                        onClick={handleDeleteSelected}
                        disabled={deleting}
                    >
                        <Trash2 className="mr-2 h-4 w-4" />
                        {deleting ? '删除中...' : `删除选中 (${selectedIcons.size})`}
                    </Button>
                )}
            </div>

            {/* 图标网格 */}
            <div className="flex-1 overflow-auto">
                {loading ? (
                    <div className="flex items-center justify-center h-40">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    </div>
                ) : filteredIcons.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
                        <ImageIcon className="h-12 w-12 mb-2" />
                        <p>暂无图标资源</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-4">
                        {filteredIcons.map((icon) => (
                            <div
                                key={icon.name}
                                className={`relative group rounded-lg border p-3 transition-all hover:shadow-md ${selectedIcons.has(icon.name)
                                    ? 'border-primary bg-primary/5'
                                    : 'border-border bg-card'
                                    }`}
                            >
                                {/* 选择框 */}
                                <div className="absolute top-2 left-2 z-10">
                                    <Checkbox
                                        checked={selectedIcons.has(icon.name)}
                                        onCheckedChange={() => toggleSelect(icon.name)}
                                    />
                                </div>

                                {/* 图标预览 */}
                                <div className="aspect-square flex items-center justify-center mb-2 bg-muted/50 rounded-md overflow-hidden">
                                    {icon.imageData ? (
                                        <img
                                            src={icon.imageData}
                                            alt={icon.name}
                                            className="max-w-full max-h-full object-contain"
                                        />
                                    ) : (
                                        <ImageIcon className="h-8 w-8 text-muted-foreground" />
                                    )}
                                </div>

                                {/* 文件名 */}
                                <p className="text-xs truncate text-center mb-1" title={icon.name}>
                                    {icon.name}
                                </p>

                                {/* 复制按钮 */}
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="w-full h-7 text-xs"
                                    onClick={() => copyFileName(icon.name)}
                                >
                                    {copiedIcon === icon.name ? (
                                        <>
                                            <Check className="mr-1 h-3 w-3" />
                                            已复制
                                        </>
                                    ) : (
                                        <>
                                            <Copy className="mr-1 h-3 w-3" />
                                            复制链接
                                        </>
                                    )}
                                </Button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}
