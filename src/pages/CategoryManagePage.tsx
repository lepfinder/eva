/**
 * 分类管理页面组件
 * 支持拖拽排序
 */
import { useState, useMemo } from 'react'
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragEndEvent
} from '@dnd-kit/core'
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    useSortable,
    verticalListSortingStrategy
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
    ArrowLeft,
    Edit,
    Trash2,
    Plus,
    Folder,
    Star,
    Newspaper,
    Bot,
    Code2,
    TrendingUp,
    Youtube,
    Wrench,
    Palette,
    FolderOpen,
    List,
    GripVertical
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter
} from '@/components/ui/dialog'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/components/ui/select'

// 可选的图标列表
const ICON_OPTIONS = [
    { value: 'Star', label: 'Star', icon: Star },
    { value: 'Folder', label: 'Folder', icon: Folder },
    { value: 'Newspaper', label: 'Newspaper', icon: Newspaper },
    { value: 'Bot', label: 'Bot', icon: Bot },
    { value: 'Code2', label: 'Code2', icon: Code2 },
    { value: 'TrendingUp', label: 'TrendingUp', icon: TrendingUp },
    { value: 'Youtube', label: 'Youtube', icon: Youtube },
    { value: 'Wrench', label: 'Wrench', icon: Wrench },
    { value: 'Palette', label: 'Palette', icon: Palette },
    { value: 'FolderOpen', label: 'FolderOpen', icon: FolderOpen },
    { value: 'List', label: 'List', icon: List }
]

// 根据图标名获取图标组件
const getIconComponent = (iconName: string) => {
    const found = ICON_OPTIONS.find((o) => o.value === iconName)
    return found?.icon || Folder
}

interface NavSubCategory {
    id: string
    title: string
    icon: string
    description: string
    enabled: boolean
    items: unknown[]
}

interface NavCategory {
    id: string
    title: string
    icon: string
    description: string
    enabled: boolean
    items: unknown[]
    subCategories: NavSubCategory[]
}

interface CategoryFormData {
    title: string
    icon: string
    description: string
    enabled: boolean
}

interface CategoryManagePageProps {
    categories: NavCategory[]
    onBack: () => void
    onRefresh: () => void
    onNavigateToSites?: (categoryId: string, subCategoryId?: string) => void
}

// 可排序的分类行组件
function SortableCategoryRow({
    item,
    type,
    onEdit,
    onDelete,
    onEnterSub,
    onNavigateToSites
}: {
    item: NavCategory | NavSubCategory
    type: 'category' | 'subcategory'
    onEdit: () => void
    onDelete: () => void
    onEnterSub?: () => void
    onNavigateToSites?: () => void
}) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({ id: item.id })

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1
    }

    const IconComponent = getIconComponent(item.icon)

    return (
        <Card ref={setNodeRef} style={style} className="mb-2">
            <CardContent className="p-4">
                <div className="flex items-center gap-4">
                    {/* 拖拽手柄 */}
                    <div
                        {...attributes}
                        {...listeners}
                        className="cursor-grab active:cursor-grabbing touch-none"
                    >
                        <GripVertical className="h-5 w-5 text-muted-foreground" />
                    </div>

                    {/* 图标 */}
                    <div className="h-10 w-10 shrink-0 rounded-lg bg-muted flex items-center justify-center">
                        <IconComponent className="h-5 w-5 text-muted-foreground" />
                    </div>

                    {/* 标题和描述 */}
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                            <h4 className="font-medium truncate">{item.title}</h4>
                            <Badge variant={item.enabled ? 'default' : 'secondary'} className="text-xs">
                                {item.enabled ? '已启用' : '已禁用'}
                            </Badge>
                        </div>
                        {item.description && (
                            <p className="text-xs text-muted-foreground truncate mt-0.5">
                                {item.description}
                            </p>
                        )}
                    </div>

                    {/* 操作按钮 */}
                    <div className="flex items-center gap-1">
                        {/* 进入子分类 */}
                        {type === 'category' && (
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={onEnterSub}
                                title="管理子分类"
                            >
                                <Folder className="h-4 w-4" />
                            </Button>
                        )}

                        {/* 查看站点 */}
                        {onNavigateToSites && (
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={onNavigateToSites}
                                title="查看站点"
                            >
                                <List className="h-4 w-4" />
                            </Button>
                        )}

                        {/* 编辑 */}
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={onEdit}
                        >
                            <Edit className="h-4 w-4" />
                        </Button>

                        {/* 删除 */}
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={onDelete}
                        >
                            <Trash2 className="h-4 w-4" />
                        </Button>
                    </div>
                </div>
            </CardContent>
        </Card>
    )
}

export function CategoryManagePage({
    categories,
    onBack,
    onRefresh,
    onNavigateToSites
}: CategoryManagePageProps): React.ReactElement {
    const [searchQuery, setSearchQuery] = useState('')
    const [filterStatus, setFilterStatus] = useState<'all' | 'enabled' | 'disabled'>('all')
    const [currentCategoryId, setCurrentCategoryId] = useState<string | null>(null)

    // 编辑对话框状态
    const [editDialogOpen, setEditDialogOpen] = useState(false)
    const [editMode, setEditMode] = useState<'add' | 'edit'>('add')
    const [editTarget, setEditTarget] = useState<{ id: string; type: 'category' | 'subcategory' } | null>(null)
    const [formData, setFormData] = useState<CategoryFormData>({
        title: '',
        icon: 'Folder',
        description: '',
        enabled: true
    })
    const [saving, setSaving] = useState(false)

    // 拖拽传感器
    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 8
            }
        }),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates
        })
    )

    // 获取当前显示的列表
    const currentItems = useMemo(() => {
        if (currentCategoryId) {
            const category = categories.find((c) => c.id === currentCategoryId)
            return category?.subCategories || []
        }
        return categories
    }, [categories, currentCategoryId])

    // 过滤后的列表
    const filteredItems = useMemo(() => {
        return currentItems.filter((item) => {
            const matchesSearch = item.title.toLowerCase().includes(searchQuery.toLowerCase())
            const matchesStatus =
                filterStatus === 'all' ||
                (filterStatus === 'enabled' && item.enabled) ||
                (filterStatus === 'disabled' && !item.enabled)
            return matchesSearch && matchesStatus
        })
    }, [currentItems, searchQuery, filterStatus])

    // 打开添加/编辑对话框
    const openAddDialog = () => {
        setEditMode('add')
        setEditTarget({ id: '', type: currentCategoryId ? 'subcategory' : 'category' })
        setFormData({ title: '', icon: 'Folder', description: '', enabled: true })
        setEditDialogOpen(true)
    }

    const openEditDialog = (item: NavCategory | NavSubCategory, type: 'category' | 'subcategory') => {
        setEditMode('edit')
        setEditTarget({ id: item.id, type })
        setFormData({
            title: item.title,
            icon: item.icon,
            description: item.description || '',
            enabled: item.enabled
        })
        setEditDialogOpen(true)
    }

    // 保存分类
    const handleSave = async () => {
        if (!formData.title.trim()) return
        setSaving(true)
        try {
            if (editMode === 'add') {
                const newId = Date.now().toString()
                if (editTarget?.type === 'subcategory' && currentCategoryId) {
                    await window.api.addSubCategory(currentCategoryId, {
                        id: newId,
                        title: formData.title,
                        icon: formData.icon,
                        description: formData.description,
                        enabled: formData.enabled
                    })
                } else {
                    await window.api.addCategory({
                        id: newId,
                        title: formData.title,
                        icon: formData.icon,
                        description: formData.description,
                        enabled: formData.enabled
                    })
                }
            } else {
                if (editTarget?.type === 'subcategory' && currentCategoryId) {
                    await window.api.updateSubCategory(currentCategoryId, editTarget.id, formData)
                } else if (editTarget) {
                    await window.api.updateCategory(editTarget.id, formData)
                }
            }
            setEditDialogOpen(false)
            onRefresh()
        } catch (err) {
            console.error('保存失败:', err)
        } finally {
            setSaving(false)
        }
    }

    // 删除分类
    const handleDelete = async (id: string, type: 'category' | 'subcategory') => {
        if (!confirm('确定要删除吗？')) return
        try {
            if (type === 'subcategory' && currentCategoryId) {
                await window.api.removeSubCategory(currentCategoryId, id)
            } else {
                await window.api.removeCategory(id)
            }
            onRefresh()
        } catch (err) {
            console.error('删除失败:', err)
        }
    }

    // 进入子分类
    const enterSubCategories = (categoryId: string) => {
        setCurrentCategoryId(categoryId)
        setSearchQuery('')
    }

    // 返回上一级
    const goBack = () => {
        if (currentCategoryId) {
            setCurrentCategoryId(null)
            setSearchQuery('')
        } else {
            onBack()
        }
    }

    // 处理拖拽结束
    const handleDragEnd = async (event: DragEndEvent) => {
        const { active, over } = event
        if (!over || active.id === over.id) return

        const oldIndex = filteredItems.findIndex((item) => item.id === active.id)
        const newIndex = filteredItems.findIndex((item) => item.id === over.id)

        if (oldIndex !== -1 && newIndex !== -1) {
            // 获取重新排序后的 ID 列表
            const reorderedItems = arrayMove(filteredItems, oldIndex, newIndex)
            const newIds = reorderedItems.map((item) => item.id)

            try {
                if (currentCategoryId) {
                    await window.api.reorderSubCategories(currentCategoryId, newIds)
                } else {
                    await window.api.reorderCategories(newIds)
                }
                onRefresh()
            } catch (err) {
                console.error('排序失败:', err)
            }
        }
    }

    return (
        <div className="h-full flex flex-col">
            {/* 顶部栏 */}
            <div className="shrink-0 pb-4 flex items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" size="icon" onClick={goBack}>
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                    <h2 className="text-xl font-semibold">
                        {currentCategoryId
                            ? `${categories.find((c) => c.id === currentCategoryId)?.title || ''} - 子分类管理`
                            : '分类管理'}
                    </h2>
                </div>
                <Button onClick={openAddDialog}>
                    <Plus className="mr-2 h-4 w-4" />
                    添加{currentCategoryId ? '子分类' : '分类'}
                </Button>
            </div>

            {/* 搜索和筛选 */}
            <div className="shrink-0 pb-4 flex gap-4">
                <Input
                    placeholder="搜索分类..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="max-w-md"
                />
                <Select value={filterStatus} onValueChange={(v) => setFilterStatus(v as typeof filterStatus)}>
                    <SelectTrigger className="w-32">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">全部</SelectItem>
                        <SelectItem value="enabled">已启用</SelectItem>
                        <SelectItem value="disabled">已禁用</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            {/* 列表 */}
            <div className="flex-1 overflow-y-auto">
                {filteredItems.length === 0 ? (
                    <div className="flex items-center justify-center h-40 text-muted-foreground">
                        暂无分类
                    </div>
                ) : (
                    <DndContext
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragEnd={handleDragEnd}
                    >
                        <SortableContext
                            items={filteredItems.map((item) => item.id)}
                            strategy={verticalListSortingStrategy}
                        >
                            {filteredItems.map((item) => (
                                <SortableCategoryRow
                                    key={item.id}
                                    item={item as NavCategory | NavSubCategory}
                                    type={currentCategoryId ? 'subcategory' : 'category'}
                                    onEdit={() =>
                                        openEditDialog(
                                            item as NavCategory | NavSubCategory,
                                            currentCategoryId ? 'subcategory' : 'category'
                                        )
                                    }
                                    onDelete={() =>
                                        handleDelete(item.id, currentCategoryId ? 'subcategory' : 'category')
                                    }
                                    onEnterSub={
                                        !currentCategoryId ? () => enterSubCategories(item.id) : undefined
                                    }
                                    onNavigateToSites={
                                        onNavigateToSites
                                            ? () =>
                                                onNavigateToSites(
                                                    currentCategoryId || item.id,
                                                    currentCategoryId ? item.id : undefined
                                                )
                                            : undefined
                                    }
                                />
                            ))}
                        </SortableContext>
                    </DndContext>
                )}
            </div>

            {/* 编辑对话框 */}
            <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
                <DialogContent className="sm:max-w-[425px]">
                    <DialogHeader>
                        <DialogTitle>
                            {editMode === 'add' ? '添加' : '编辑'}
                            {editTarget?.type === 'subcategory' ? '子分类' : '分类'}
                        </DialogTitle>
                    </DialogHeader>

                    <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                            <Label htmlFor="title">标题</Label>
                            <Input
                                id="title"
                                value={formData.title}
                                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                                placeholder="输入标题"
                            />
                        </div>

                        <div className="grid gap-2">
                            <Label htmlFor="icon">图标</Label>
                            <Select
                                value={formData.icon}
                                onValueChange={(v) => setFormData({ ...formData, icon: v })}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {ICON_OPTIONS.map((option) => {
                                        const Icon = option.icon
                                        return (
                                            <SelectItem key={option.value} value={option.value}>
                                                <div className="flex items-center gap-2">
                                                    <Icon className="h-4 w-4" />
                                                    <span>{option.label}</span>
                                                </div>
                                            </SelectItem>
                                        )
                                    })}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="grid gap-2">
                            <Label htmlFor="description">描述</Label>
                            <Textarea
                                id="description"
                                value={formData.description}
                                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                placeholder="输入描述（可选）"
                                rows={3}
                            />
                        </div>

                        <div className="flex items-center justify-between">
                            <Label htmlFor="enabled">启用状态</Label>
                            <Switch
                                id="enabled"
                                checked={formData.enabled}
                                onCheckedChange={(v) => setFormData({ ...formData, enabled: v })}
                            />
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
                            取消
                        </Button>
                        <Button onClick={handleSave} disabled={saving || !formData.title.trim()}>
                            {saving ? '保存中...' : '保存'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
