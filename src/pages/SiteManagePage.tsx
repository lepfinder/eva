/**
 * 站点管理页面组件
 */
import { useState, useEffect, useRef } from 'react'
import {
    ArrowLeft,
    Edit,
    Trash2,
    Plus,
    Search,
    RefreshCw,
    Upload
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
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
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from '@/components/ui/table'

type BrowserType = 'chrome' | 'edge' | 'safari' | 'firefox' | 'default'

interface NavLinkItem {
    id: string
    title: string
    href: string
    description: string
    icon: string
    enabled: boolean
    browser?: BrowserType
}

interface NavSubCategory {
    id: string
    title: string
    icon: string
    description: string
    enabled: boolean
    items: NavLinkItem[]
}

interface NavCategory {
    id: string
    title: string
    icon: string
    description: string
    enabled: boolean
    items: NavLinkItem[]
    subCategories: NavSubCategory[]
}

interface SiteFormData {
    href: string
    title: string
    icon: string
    description: string
    categoryId: string
    subCategoryId: string
}

// 模块级图标缓存，切换页面后重用，避免重复 IPC 调用
const iconCache = new Map<string, string>()

/**
 * 站点图标缩略图：异步加载本地图标，有缓存，失败时降级为占位块
 */
function SiteIcon({ icon }: { icon?: string }) {
    const [src, setSrc] = useState<string | null>(() => {
        if (!icon) return null
        if (icon.startsWith('http') || icon.startsWith('/')) return icon
        return iconCache.get(icon) ?? null
    })
    const mountedRef = useRef(true)

    useEffect(() => {
        mountedRef.current = true
        return () => { mountedRef.current = false }
    }, [])

    useEffect(() => {
        if (!icon) { setSrc(null); return }
        if (icon.startsWith('http') || icon.startsWith('/')) { setSrc(icon); return }
        if (iconCache.has(icon)) { setSrc(iconCache.get(icon)!); return }

        window.api.getNavIconData(icon).then((data) => {
            if (!mountedRef.current) return
            if (data) {
                iconCache.set(icon, data)
                setSrc(data)
            }
        })
    }, [icon])

    if (!src) {
        // 没有图标时展示空白占位，宽高与有图标时一致
        return <span className="h-6 w-6 rounded bg-muted flex-shrink-0 inline-block" />
    }
    return (
        <img
            src={src}
            alt=""
            className="h-6 w-6 rounded object-contain flex-shrink-0"
            onError={() => setSrc(null)}
        />
    )
}

interface SiteManagePageProps {
    categories: NavCategory[]
    onBack: () => void
    onRefresh: () => void
    initialCategoryId?: string
    initialSubCategoryId?: string
}

// 扁平化的站点数据
interface FlatSite {
    item: NavLinkItem
    categoryId: string
    categoryTitle: string
    subCategoryId: string | null
    subCategoryTitle: string | null
}

export function SiteManagePage({
    categories,
    onBack,
    onRefresh,
    initialCategoryId,
    initialSubCategoryId
}: SiteManagePageProps): React.ReactElement {
    const [searchQuery, setSearchQuery] = useState('')
    const [filterCategoryId, setFilterCategoryId] = useState<string>(initialCategoryId || 'all')
    const [filterSubCategoryId, setFilterSubCategoryId] = useState<string>(initialSubCategoryId || 'all')
    const [editDialogOpen, setEditDialogOpen] = useState(false)
    const [editMode, setEditMode] = useState<'add' | 'edit'>('add')
    const [editSiteId, setEditSiteId] = useState<string | null>(null)
    const [editSiteCategoryId, setEditSiteCategoryId] = useState<string | null>(null)
    const [editSiteSubCategoryId, setEditSiteSubCategoryId] = useState<string | null>(null)
    const [formData, setFormData] = useState<SiteFormData>({
        href: '',
        title: '',
        icon: '',
        description: '',
        categoryId: '',
        subCategoryId: ''
    })
    const [saving, setSaving] = useState(false)
    const [fetching, setFetching] = useState(false)
    const [iconPreview, setIconPreview] = useState<string | null>(null)

    // 初始化时设置过滤器
    useEffect(() => {
        if (initialCategoryId) {
            setFilterCategoryId(initialCategoryId)
        }
        if (initialSubCategoryId) {
            setFilterSubCategoryId(initialSubCategoryId)
        }
    }, [initialCategoryId, initialSubCategoryId])

    // 监听从剪贴板添加站点的事件
    useEffect(() => {
        const handleOpenAddDialog = async (event: CustomEvent<{ url: string }>) => {
            const url = event.detail.url
            console.log('[SiteManagePage] Open add dialog with URL:', url)

            // 设置表单数据
            setEditMode('add')
            setEditSiteId(null)
            setEditSiteCategoryId(null)
            setEditSiteSubCategoryId(null)
            setFormData({
                href: url,
                title: '',
                icon: '',
                description: '',
                categoryId: filterCategoryId !== 'all' ? filterCategoryId : (categories[0]?.id || ''),
                subCategoryId: ''
            })
            setIconPreview(null)
            setEditDialogOpen(true)

            // 自动获取站点信息
            try {
                const result = await window.api.fetchSiteInfo(url)
                if (result.success) {
                    setFormData((prev) => ({
                        ...prev,
                        title: result.title || prev.title,
                        description: result.description || prev.description,
                        icon: result.icon || prev.icon
                    }))
                    if (result.icon) {
                        const iconData = await window.api.getNavIconData(result.icon)
                        setIconPreview(iconData || null)
                    }
                }
            } catch (err) {
                console.error('自动获取站点信息失败:', err)
            }
        }

        window.addEventListener('open-add-site-dialog', handleOpenAddDialog as unknown as EventListener)
        return () => {
            window.removeEventListener('open-add-site-dialog', handleOpenAddDialog as unknown as EventListener)
        }
    }, [categories, filterCategoryId])

    // 获取所有站点的扁平列表
    const getAllSites = (): FlatSite[] => {
        const sites: FlatSite[] = []

        categories.forEach((category) => {
            // 一级分类下的直接站点
            category.items.forEach((item) => {
                sites.push({
                    item,
                    categoryId: category.id,
                    categoryTitle: category.title,
                    subCategoryId: null,
                    subCategoryTitle: null
                })
            })

            // 子分类下的站点
            category.subCategories?.forEach((sub) => {
                sub.items.forEach((item) => {
                    sites.push({
                        item,
                        categoryId: category.id,
                        categoryTitle: category.title,
                        subCategoryId: sub.id,
                        subCategoryTitle: sub.title
                    })
                })
            })
        })

        return sites
    }

    // 过滤站点
    const filteredSites = getAllSites().filter((site) => {
        const matchSearch =
            site.item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
            site.item.href.toLowerCase().includes(searchQuery.toLowerCase()) ||
            site.item.description?.toLowerCase().includes(searchQuery.toLowerCase())

        const matchCategory = filterCategoryId === 'all' || site.categoryId === filterCategoryId
        const matchSubCategory = filterSubCategoryId === 'all' ||
            (filterSubCategoryId === 'none' && site.subCategoryId === null) ||
            site.subCategoryId === filterSubCategoryId

        return matchSearch && matchCategory && matchSubCategory
    })

    // 当前选中分类的子分类列表
    const currentSubCategories = filterCategoryId === 'all'
        ? []
        : categories.find(c => c.id === filterCategoryId)?.subCategories || []

    // 打开添加对话框
    const openAddDialog = () => {
        setEditMode('add')
        setEditSiteId(null)
        setEditSiteCategoryId(null)
        setEditSiteSubCategoryId(null)
        setFormData({
            href: '',
            title: '',
            icon: '',
            description: '',
            categoryId: filterCategoryId !== 'all' ? filterCategoryId : (categories[0]?.id || ''),
            subCategoryId: ''
        })
        setIconPreview(null)
        setEditDialogOpen(true)
    }

    // 打开编辑对话框
    const openEditDialog = async (site: FlatSite) => {
        setEditMode('edit')
        setEditSiteId(site.item.id)
        setEditSiteCategoryId(site.categoryId)
        setEditSiteSubCategoryId(site.subCategoryId)
        setFormData({
            href: site.item.href,
            title: site.item.title,
            icon: site.item.icon || '',
            description: site.item.description || '',
            categoryId: site.categoryId,
            subCategoryId: site.subCategoryId || ''
        })
        // 加载图标预览
        if (site.item.icon) {
            const iconData = await window.api.getNavIconData(site.item.icon)
            setIconPreview(iconData || null)
        } else {
            setIconPreview(null)
        }
        setEditDialogOpen(true)
    }

    // 获取站点信息（标题、描述、图标）
    const handleFetchSiteInfo = async () => {
        if (!formData.href.trim()) return
        setFetching(true)
        try {
            const result = await window.api.fetchSiteInfo(formData.href.trim())
            if (result.success) {
                setFormData((prev) => ({
                    ...prev,
                    title: result.title || prev.title,
                    description: result.description || prev.description,
                    icon: result.icon || prev.icon
                }))
                // 加载图标预览
                if (result.icon) {
                    const iconData = await window.api.getNavIconData(result.icon)
                    setIconPreview(iconData || null)
                }
            } else {
                console.error('获取站点信息失败:', result.error)
            }
        } catch (err) {
            console.error('获取站点信息失败:', err)
        } finally {
            setFetching(false)
        }
    }

    // 保存站点
    const handleSave = async () => {
        if (!formData.href.trim() || !formData.title.trim() || !formData.categoryId) return
        setSaving(true)
        try {
            const newItem: NavLinkItem = {
                id: editSiteId || Date.now().toString(),
                title: formData.title,
                href: formData.href,
                description: formData.description,
                icon: formData.icon,
                enabled: true
            }

            if (editMode === 'add') {
                await window.api.addNavigationItem(
                    formData.categoryId,
                    formData.subCategoryId || null,
                    newItem
                )
            } else if (editMode === 'edit' && editSiteId && editSiteCategoryId !== null) {
                const categoryChanged = editSiteCategoryId !== formData.categoryId ||
                    editSiteSubCategoryId !== (formData.subCategoryId || null)

                // 先更新站点信息（在原位置）
                await window.api.updateNavigationItem(
                    editSiteCategoryId,
                    editSiteSubCategoryId,
                    editSiteId,
                    {
                        title: formData.title,
                        href: formData.href,
                        description: formData.description,
                        icon: formData.icon
                    }
                )

                // 如果分类发生变化，移动站点到新分类
                if (categoryChanged) {
                    await window.api.moveNavigationItem(
                        editSiteCategoryId,
                        editSiteSubCategoryId,
                        editSiteId,
                        formData.categoryId,
                        formData.subCategoryId || null
                    )
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

    // 删除站点
    const handleDelete = async (site: FlatSite) => {
        if (!confirm(`确定要删除站点 "${site.item.title}" 吗？`)) return
        try {
            await window.api.removeNavigationItem(
                site.categoryId,
                site.subCategoryId,
                site.item.id
            )
            onRefresh()
        } catch (err) {
            console.error('删除失败:', err)
        }
    }

    // 表单中选择的分类的子分类列表
    const formSubCategories = formData.categoryId
        ? categories.find(c => c.id === formData.categoryId)?.subCategories || []
        : []

    return (
        <div className="h-full flex flex-col">
            {/* 顶部栏 */}
            <div className="shrink-0 pb-4 flex items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" size="icon" onClick={onBack}>
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                    <h2 className="text-xl font-semibold">站点管理</h2>
                    <span className="text-sm text-muted-foreground">
                        共 {filteredSites.length} 个站点
                    </span>
                </div>

                <Button onClick={openAddDialog}>
                    <Plus className="mr-2 h-4 w-4" />
                    添加站点
                </Button>
            </div>

            {/* 搜索和过滤 */}
            <div className="shrink-0 pb-4 flex gap-4 flex-wrap">
                <div className="relative w-64">
                    <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                        <Search className="h-4 w-4 text-muted-foreground" />
                    </span>
                    <Input
                        placeholder="搜索站点..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-9"
                    />
                </div>
                <Select
                    value={filterCategoryId}
                    onValueChange={(v) => {
                        setFilterCategoryId(v)
                        setFilterSubCategoryId('all')
                    }}
                >
                    <SelectTrigger className="w-40">
                        <SelectValue placeholder="全部分类" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">全部分类</SelectItem>
                        {categories.map((cat) => (
                            <SelectItem key={cat.id} value={cat.id}>
                                {cat.title}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <Select
                    value={filterSubCategoryId}
                    onValueChange={setFilterSubCategoryId}
                    disabled={filterCategoryId === 'all'}
                >
                    <SelectTrigger className="w-40">
                        <SelectValue placeholder="全部子分类" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">全部子分类</SelectItem>
                        <SelectItem value="none">无子分类</SelectItem>
                        {currentSubCategories.map((sub) => (
                            <SelectItem key={sub.id} value={sub.id}>
                                {sub.title}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            {/* 站点列表 */}
            <div className="flex-1 overflow-auto border rounded-lg">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-[200px]">名称</TableHead>
                            <TableHead className="w-[250px]">链接</TableHead>
                            <TableHead className="w-[100px]">一级分类</TableHead>
                            <TableHead className="w-[100px]">二级分类</TableHead>
                            <TableHead>描述</TableHead>
                            <TableHead className="w-[80px] text-right">操作</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filteredSites.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                                    暂无站点数据
                                </TableCell>
                            </TableRow>
                        ) : (
                            filteredSites.map((site) => (
                                <TableRow key={`${site.categoryId}-${site.subCategoryId}-${site.item.id}`}>
                                    <TableCell>
                                        <div className="flex items-center gap-2">
                                            <SiteIcon icon={site.item.icon} />
                                            <span className="font-medium truncate max-w-[160px]">
                                                {site.item.title}
                                            </span>
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <a
                                            href={site.item.href}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-primary hover:underline truncate block max-w-[220px]"
                                            onClick={(e) => {
                                                e.preventDefault()
                                                window.api.openNavLinkInBrowser(site.item.href, 'default')
                                            }}
                                        >
                                            {site.item.href}
                                        </a>
                                    </TableCell>
                                    <TableCell>
                                        <Badge variant="secondary" className="text-xs">
                                            {site.categoryTitle}
                                        </Badge>
                                    </TableCell>
                                    <TableCell>
                                        {site.subCategoryTitle ? (
                                            <Badge variant="outline" className="text-xs">
                                                {site.subCategoryTitle}
                                            </Badge>
                                        ) : (
                                            <span className="text-muted-foreground text-xs">-</span>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        <span className="text-sm text-muted-foreground line-clamp-2 max-w-[200px]">
                                            {site.item.description || '-'}
                                        </span>
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex justify-end gap-1">
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-8 w-8"
                                                onClick={() => openEditDialog(site)}
                                            >
                                                <Edit className="h-4 w-4" />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-8 w-8 text-destructive hover:text-destructive"
                                                onClick={() => handleDelete(site)}
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </div>

            {/* 编辑对话框 */}
            <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
                <DialogContent className="sm:max-w-[500px]">
                    <DialogHeader>
                        <DialogTitle>
                            {editMode === 'add' ? '添加站点' : '编辑站点'}
                        </DialogTitle>
                    </DialogHeader>

                    <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                            <Label htmlFor="href">站点链接 *</Label>
                            <div className="flex gap-2">
                                <Input
                                    id="href"
                                    value={formData.href}
                                    onChange={(e) => setFormData({ ...formData, href: e.target.value })}
                                    placeholder="https://example.com"
                                    className="flex-1"
                                />
                                <Button
                                    variant="outline"
                                    size="icon"
                                    onClick={handleFetchSiteInfo}
                                    disabled={!formData.href.trim() || fetching}
                                    title="获取站点信息"
                                >
                                    <RefreshCw className={`h-4 w-4 ${fetching ? 'animate-spin' : ''}`} />
                                </Button>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                输入完整的网站链接后，点击刷新按钮自动获取网站标题、描述和图标
                            </p>
                        </div>

                        <div className="grid gap-2">
                            <Label htmlFor="title">站点名称 *</Label>
                            <Input
                                id="title"
                                value={formData.title}
                                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                                placeholder="输入站点名称"
                            />
                        </div>

                        <div className="grid gap-2">
                            <Label htmlFor="icon">站点图标</Label>
                            <div className="flex gap-2 items-center">
                                {/* 图标预览 */}
                                {iconPreview && (
                                    <div className="h-10 w-10 rounded-lg border bg-muted/50 flex items-center justify-center overflow-hidden shrink-0">
                                        <img
                                            src={iconPreview}
                                            alt="图标预览"
                                            className="max-w-full max-h-full object-contain"
                                        />
                                    </div>
                                )}
                                <Input
                                    id="icon"
                                    value={formData.icon}
                                    onChange={(e) => setFormData({ ...formData, icon: e.target.value })}
                                    placeholder="图标文件名或URL"
                                    className="flex-1"
                                />
                                <Button variant="outline" disabled>
                                    <Upload className="mr-2 h-4 w-4" />
                                    上传图片
                                </Button>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                系统会自动获取网站图标，也可手动输入URL或上传本地图片
                            </p>
                        </div>

                        <div className="grid gap-2">
                            <Label htmlFor="categoryId">分类 *</Label>
                            <Select
                                value={formData.categoryId}
                                onValueChange={(v) => setFormData({ ...formData, categoryId: v, subCategoryId: '' })}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="选择分类" />
                                </SelectTrigger>
                                <SelectContent>
                                    {categories.map((cat) => (
                                        <SelectItem key={cat.id} value={cat.id}>
                                            {cat.title}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="grid gap-2">
                            <Label htmlFor="subCategoryId">子分类</Label>
                            <Select
                                value={formData.subCategoryId || 'none'}
                                onValueChange={(v) => setFormData({ ...formData, subCategoryId: v === 'none' ? '' : v })}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="选择子分类" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="none">无子分类</SelectItem>
                                    {formSubCategories.map((sub) => (
                                        <SelectItem key={sub.id} value={sub.id}>
                                            {sub.title}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="grid gap-2">
                            <Label htmlFor="description">描述</Label>
                            <Textarea
                                id="description"
                                value={formData.description}
                                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                placeholder="输入站点描述（可选）"
                                rows={3}
                            />
                        </div>
                    </div>

                    <DialogFooter className="flex gap-2">
                        <Button variant="outline" onClick={() => setEditDialogOpen(false)} className="flex-1">
                            取消
                        </Button>
                        <Button
                            onClick={handleSave}
                            disabled={saving || !formData.href.trim() || !formData.title.trim() || !formData.categoryId}
                            className="flex-1"
                        >
                            {saving ? '保存中...' : editMode === 'add' ? '添加站点' : '更新站点'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
