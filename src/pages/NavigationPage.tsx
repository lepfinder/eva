import { useState, useEffect, useCallback, useRef, useMemo, useDeferredValue } from 'react'
import {
    Search,
    ChevronDown,
    ChevronRight,
    FolderOpen,
    Upload,
    Loader2,
    Star,
    Chrome,
    Globe,
    Edit,
    Trash2,
    MoreVertical,
    Settings,
    Folder,
    Newspaper,
    Bot,
    Code2,
    TrendingUp,
    Youtube,
    Wrench,
    Palette,
    List,
    type LucideIcon
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/components/ui/dialog'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/components/ui/select'
import { CategoryManagePage } from './CategoryManagePage'
import { SiteManagePage } from './SiteManagePage'
import { ResourceManagePage } from './ResourceManagePage'
import { FaviconDownloadPage } from './FaviconDownloadPage'

// 导航项接口
interface NavLinkItem {
    id: string
    title: string
    href: string
    description: string
    icon: string
    enabled: boolean
    browser?: 'chrome' | 'edge' | 'safari' | 'firefox' | 'default'
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

interface NavigationData {
    navigationItems: NavCategory[]
}

interface FilteredCategory extends NavCategory {
    filteredDirectItems: NavLinkItem[]
    filteredSubCategories: NavSubCategory[]
}

// 编辑上下文
interface EditContext {
    item: NavLinkItem
    categoryId: string
    subCategoryId: string | null
}

// 图标缓存 - 缓存已加载的 base64 图标数据
const iconCache = new Map<string, string>()

// 分类图标映射
const CATEGORY_ICONS: Record<string, LucideIcon> = {
    Star: Star,
    Folder: Folder,
    Newspaper: Newspaper,
    Bot: Bot,
    Code2: Code2,
    TrendingUp: TrendingUp,
    Youtube: Youtube,
    Wrench: Wrench,
    Palette: Palette,
    FolderOpen: FolderOpen,
    List: List
}

function getCategoryIcon(iconName: string): LucideIcon {
    return CATEGORY_ICONS[iconName] || Star
}

// 视图类型
type ViewType = 'navigation' | 'category-manage' | 'site-manage' | 'resource-manage' | 'icon-download'

interface NavigationPageProps {
    pendingAddUrl?: string | null
    onPendingAddUrlHandled?: () => void
}

export function NavigationPage({
    pendingAddUrl,
    onPendingAddUrlHandled
}: NavigationPageProps = {}): React.ReactElement {
    const [data, setData] = useState<NavigationData>({ navigationItems: [] })
    const [loading, setLoading] = useState(true)
    const [searchQuery, setSearchQuery] = useState('')
    const deferredSearchQuery = useDeferredValue(searchQuery)
    const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set())
    const [activeSection, setActiveSection] = useState<string | null>(null)
    const contentRef = useRef<HTMLDivElement>(null)
    const sectionRefs = useRef<Map<string, HTMLDivElement>>(new Map())
    const scrollRafPendingRef = useRef(false)

    // 当前视图
    const [currentView, setCurrentView] = useState<ViewType>('navigation')

    // 站点管理的分类筛选
    const [siteManageCategoryId, setSiteManageCategoryId] = useState<string | undefined>(undefined)
    const [siteManageSubCategoryId, setSiteManageSubCategoryId] = useState<string | undefined>(undefined)

    // 编辑对话框状态
    const [editDialogOpen, setEditDialogOpen] = useState(false)
    const [editContext, setEditContext] = useState<EditContext | null>(null)
    const [editForm, setEditForm] = useState<Partial<NavLinkItem>>({})
    const [editCategoryId, setEditCategoryId] = useState<string>('')
    const [editSubCategoryId, setEditSubCategoryId] = useState<string>('')
    const [saving, setSaving] = useState(false)

    // 加载导航数据
    const fetchData = useCallback(async () => {
        setLoading(true)
        try {
            const navData = await window.api.getNavigationData()
            setData(navData)
            // 默认折叠所有分类
            setExpandedCategories(new Set())
        } catch (err) {
            console.error('加载导航数据失败:', err)
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        void fetchData()
    }, [fetchData])

    // 处理从剪贴板添加站点
    useEffect(() => {
        if (!pendingAddUrl) return

        console.log('[NavigationPage] Processing pending add URL:', pendingAddUrl)
        // 切换到站点管理视图
        setCurrentView('site-manage')
        setSiteManageCategoryId(undefined)
        setSiteManageSubCategoryId(undefined)
        // 通过自定义事件传递 URL 给 SiteManagePage（延迟确保组件已挂载）
        const timer = setTimeout(() => {
            window.dispatchEvent(
                new CustomEvent('open-add-site-dialog', { detail: { url: pendingAddUrl } })
            )
            // 通知父组件已处理
            onPendingAddUrlHandled?.()
        }, 200)

        return () => clearTimeout(timer)
    }, [pendingAddUrl, onPendingAddUrlHandled])

    // 导入数据
    const handleImport = async (): Promise<void> => {
        const filePath = await window.api.openFile([{ name: 'JSON', extensions: ['json'] }])
        if (filePath) {
            const result = await window.api.importNavigationData(filePath)
            if (result.success) {
                fetchData()
            } else {
                console.error('导入失败:', result.error)
            }
        }
    }

    // 打开链接
    const handleOpenLink = async (item: NavLinkItem): Promise<void> => {
        await window.api.openNavLinkInBrowser(item.href, item.browser || 'default')
    }

    // 打开数据目录
    const handleOpenDataDir = async (): Promise<void> => {
        const dir = await window.api.getNavigationDataDir()
        if (dir) {
            await window.api.openInFinder(dir)
        }
    }

    // 切换分类展开状态
    const toggleCategory = (categoryId: string): void => {
        const newExpanded = new Set(expandedCategories)
        if (newExpanded.has(categoryId)) {
            newExpanded.delete(categoryId)
        } else {
            newExpanded.add(categoryId)
        }
        setExpandedCategories(newExpanded)
    }

    // 滚动到指定分类
    const scrollToSection = (sectionId: string): void => {
        const element = sectionRefs.current.get(sectionId)
        if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'start' })
            setActiveSection(sectionId)
        }
    }

    // 监听滚动，更新当前激活的分类
    const handleScroll = useCallback(() => {
        if (!contentRef.current || scrollRafPendingRef.current) return

        scrollRafPendingRef.current = true
        window.requestAnimationFrame(() => {
            const container = contentRef.current
            if (!container) {
                scrollRafPendingRef.current = false
                return
            }

            const containerRect = container.getBoundingClientRect()
            let currentSection: string | null = null

            sectionRefs.current.forEach((element, id) => {
                const rect = element.getBoundingClientRect()
                const relativeTop = rect.top - containerRect.top

                if (relativeTop <= 100) {
                    currentSection = id
                }
            })

            setActiveSection((prev) => (prev === currentSection ? prev : currentSection))
            scrollRafPendingRef.current = false
        })
    }, [])

    // 打开编辑对话框
    const handleEdit = (item: NavLinkItem, categoryId: string, subCategoryId: string | null) => {
        setEditContext({ item, categoryId, subCategoryId })
        setEditForm({
            title: item.title,
            href: item.href,
            description: item.description,
            icon: item.icon,
            browser: item.browser || 'default'
        })
        setEditCategoryId(categoryId)
        setEditSubCategoryId(subCategoryId || '')
        setEditDialogOpen(true)
    }

    // 保存编辑
    const handleSaveEdit = async () => {
        if (!editContext) return

        setSaving(true)
        try {
            // 先更新站点信息
            const result = await window.api.updateNavigationItem(
                editContext.categoryId,
                editContext.subCategoryId,
                editContext.item.id,
                editForm
            )

            if (!result.success) {
                console.error('保存失败:', result.error)
                return
            }

            // 检查分类是否变化，如果变化则移动站点
            const categoryChanged = editContext.categoryId !== editCategoryId ||
                editContext.subCategoryId !== (editSubCategoryId || null)

            if (categoryChanged) {
                const moveResult = await window.api.moveNavigationItem(
                    editContext.categoryId,
                    editContext.subCategoryId,
                    editContext.item.id,
                    editCategoryId,
                    editSubCategoryId || null
                )

                if (!moveResult.success) {
                    console.error('移动失败:', moveResult.error)
                }
            }

            setEditDialogOpen(false)
            setEditContext(null)
            fetchData()
        } catch (err) {
            console.error('保存失败:', err)
        } finally {
            setSaving(false)
        }
    }

    // 删除导航项
    const handleDelete = async (item: NavLinkItem, categoryId: string, subCategoryId: string | null) => {
        if (!confirm(`确定要删除「${item.title}」吗？`)) return

        try {
            const result = await window.api.removeNavigationItem(categoryId, subCategoryId, item.id)
            if (result.success) {
                fetchData()
            } else {
                console.error('删除失败:', result.error)
            }
        } catch (err) {
            console.error('删除失败:', err)
        }
    }

    // 缓存过滤后的分类结果，避免滚动或输入时重复全量计算
    const visibleCategories = useMemo<FilteredCategory[]>(() => {
        const query = deferredSearchQuery.trim().toLowerCase()

        const filterItems = (items: NavLinkItem[]): NavLinkItem[] => {
            if (!query) return items.filter((i) => i.enabled !== false)
            return items.filter(
                (item) =>
                    item.enabled !== false &&
                    (item.title.toLowerCase().includes(query) ||
                        item.description?.toLowerCase().includes(query) ||
                        item.href.toLowerCase().includes(query))
            )
        }

        return data.navigationItems
            .filter((category) => category.enabled !== false)
            .map((category) => {
                const filteredDirectItems = filterItems(category.items)
                const filteredSubCategories = (category.subCategories || [])
                    .filter((sub) => sub.enabled !== false)
                    .map((sub) => ({
                        ...sub,
                        items: filterItems(sub.items)
                    }))
                    .filter((sub) => sub.items.length > 0 || !query)

                const hasMatches = !query || filteredDirectItems.length > 0 ||
                    filteredSubCategories.some((sub) => sub.items.length > 0)

                if (!hasMatches) {
                    return null
                }

                return {
                    ...category,
                    filteredDirectItems,
                    filteredSubCategories
                }
            })
            .filter((category): category is FilteredCategory => category !== null)
    }, [data.navigationItems, deferredSearchQuery])

    // 获取浏览器图标
    const getBrowserIcon = (browser?: string): React.ReactNode => {
        switch (browser) {
            case 'chrome':
                return <Chrome className="h-3 w-3" />
            case 'edge':
                return <span className="text-xs font-bold">E</span>
            case 'safari':
                return <span className="text-xs">🧭</span>
            case 'firefox':
                return <span className="text-xs">🦊</span>
            default:
                return <Globe className="h-3 w-3" />
        }
    }

    // 导航项卡片组件
    const NavItemCard = ({
        item,
        categoryId,
        subCategoryId,
        onClick
    }: {
        item: NavLinkItem
        categoryId: string
        subCategoryId: string | null
        onClick: () => void
    }): React.ReactElement => {
        // 图标加载状态
        const [iconSrc, setIconSrc] = useState<string | null>(null)
        const [iconError, setIconError] = useState(false)

        // 加载本地图标
        useEffect(() => {
            if (!item.icon) return
            if (item.icon.startsWith('http') || item.icon.startsWith('/')) {
                setIconSrc(item.icon)
                return
            }

            // 检查缓存
            if (iconCache.has(item.icon)) {
                setIconSrc(iconCache.get(item.icon) || null)
                return
            }

            // 异步加载图标
            window.api.getNavIconData(item.icon).then((data) => {
                if (data) {
                    iconCache.set(item.icon, data)
                    setIconSrc(data)
                } else {
                    setIconError(true)
                }
            })
        }, [item.icon])

        return (
            <Card className="cursor-pointer transition-all hover:shadow-md hover:border-primary/50 group relative">
                <CardContent className="p-4" onClick={onClick}>
                    <div className="flex items-start gap-3">
                        {/* 图标 */}
                        <div className="h-10 w-10 shrink-0 rounded-lg bg-muted flex items-center justify-center overflow-hidden">
                            {iconSrc && !iconError ? (
                                <img
                                    src={iconSrc}
                                    alt={item.title}
                                    className="h-6 w-6 object-contain"
                                    onError={() => setIconError(true)}
                                />
                            ) : (
                                <Star className="h-5 w-5 text-muted-foreground" />
                            )}
                        </div>

                        {/* 内容 */}
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                                <h4 className="font-medium truncate">{item.title}</h4>
                                {item.browser && item.browser !== 'default' && (
                                    <Badge variant="outline" className="h-5 px-1">
                                        {getBrowserIcon(item.browser)}
                                    </Badge>
                                )}
                            </div>
                            {item.description && (
                                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                                    {item.description}
                                </p>
                            )}
                        </div>

                        {/* 右键菜单按钮 */}
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity absolute top-2 right-2"
                                >
                                    <MoreVertical className="h-4 w-4" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={(e) => {
                                    e.stopPropagation()
                                    handleEdit(item, categoryId, subCategoryId)
                                }}>
                                    <Edit className="mr-2 h-4 w-4" />
                                    编辑
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                    className="text-destructive focus:text-destructive"
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        handleDelete(item, categoryId, subCategoryId)
                                    }}
                                >
                                    <Trash2 className="mr-2 h-4 w-4" />
                                    删除
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                </CardContent>
            </Card>
        )
    }

    if (loading) {
        return (
            <div className="flex h-[50vh] items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        )
    }

    // 空状态
    if (data.navigationItems.length === 0) {
        return (
            <div className="space-y-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight">网站导航</h1>
                        <p className="text-muted-foreground">收藏和管理常用网站</p>
                    </div>
                </div>

                <Card>
                    <CardContent className="flex flex-col items-center justify-center py-16">
                        <FolderOpen className="h-16 w-16 text-muted-foreground/30" />
                        <h3 className="mt-4 text-lg font-medium">暂无导航数据</h3>
                        <p className="mt-2 text-center text-sm text-muted-foreground">
                            导入 JSON 配置文件开始使用网站导航功能
                        </p>
                        <div className="mt-6 flex gap-2">
                            <Button onClick={handleImport}>
                                <Upload className="mr-2 h-4 w-4" />
                                导入配置文件
                            </Button>
                            <Button variant="outline" onClick={handleOpenDataDir}>
                                <FolderOpen className="mr-2 h-4 w-4" />
                                打开数据目录
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            </div>
        )
    }

    // 如果显示分类管理视图
    if (currentView === 'category-manage') {
        return (
            <CategoryManagePage
                categories={data.navigationItems}
                onBack={() => setCurrentView('navigation')}
                onRefresh={fetchData}
                onNavigateToSites={(categoryId, subCategoryId) => {
                    setSiteManageCategoryId(categoryId)
                    setSiteManageSubCategoryId(subCategoryId)
                    setCurrentView('site-manage')
                }}
            />
        )
    }

    // 如果显示站点管理视图
    if (currentView === 'site-manage') {
        return (
            <SiteManagePage
                categories={data.navigationItems}
                onBack={() => {
                    setSiteManageCategoryId(undefined)
                    setSiteManageSubCategoryId(undefined)
                    setCurrentView('navigation')
                }}
                onRefresh={fetchData}
                initialCategoryId={siteManageCategoryId}
                initialSubCategoryId={siteManageSubCategoryId}
            />
        )
    }

    // 如果显示资源管理视图
    if (currentView === 'resource-manage') {
        return (
            <ResourceManagePage
                onBack={() => setCurrentView('navigation')}
            />
        )
    }

    // 如果显示 Favicon 下载视图
    if (currentView === 'icon-download') {
        return (
            <FaviconDownloadPage
                onBack={() => setCurrentView('navigation')}
            />
        )
    }

    return (
        <div className="flex h-full gap-4">
            {/* 左侧分类列表 - 固定位置，锚点导航 */}
            <div className="w-56 shrink-0 flex flex-col">
                <div className="mb-3 flex gap-2">
                    <Button variant="outline" size="sm" className="flex-1" onClick={handleImport}>
                        <Upload className="mr-2 h-4 w-4" />
                        导入配置
                    </Button>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="icon" className="h-9 w-9">
                                <Settings className="h-4 w-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setCurrentView('category-manage')}>
                                分类管理
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => {
                                setSiteManageCategoryId(undefined)
                                setSiteManageSubCategoryId(undefined)
                                setCurrentView('site-manage')
                            }}>
                                站点管理
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => setCurrentView('resource-manage')}>
                                资源管理
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setCurrentView('icon-download')}>
                                网站图标下载
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>

                <ScrollArea className="flex-1">
                    <nav className="space-y-1 pr-2">
                        {visibleCategories.map((category) => {
                                const hasSubCategories =
                                    category.filteredSubCategories && category.filteredSubCategories.length > 0
                                const isActive = activeSection === category.id
                                const isExpanded = expandedCategories.has(category.id)

                                const CategoryIcon = getCategoryIcon(category.icon)

                                return (
                                    <div key={category.id}>
                                        <Button
                                            variant={isActive ? 'secondary' : 'ghost'}
                                            className="w-full justify-between h-10 px-3"
                                            onClick={() => {
                                                scrollToSection(category.id)
                                                if (hasSubCategories) {
                                                    toggleCategory(category.id)
                                                }
                                            }}
                                        >
                                            <div className="flex items-center gap-2 min-w-0">
                                                <CategoryIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                                                <span className="truncate text-sm">{category.title}</span>
                                            </div>
                                            {hasSubCategories && (
                                                isExpanded ? (
                                                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                                                ) : (
                                                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                                                )
                                            )}
                                        </Button>

                                        {/* 子分类快捷链接 */}
                                        {hasSubCategories && isExpanded && (
                                            <div className="ml-6 mt-1 space-y-0.5">
                                                {category.filteredSubCategories
                                                    .map((sub) => (
                                                        <Button
                                                            key={sub.id}
                                                            variant={activeSection === sub.id ? 'secondary' : 'ghost'}
                                                            size="sm"
                                                            className="w-full justify-start text-sm h-8 pl-2"
                                                            onClick={() => scrollToSection(sub.id)}
                                                        >
                                                            {sub.title}
                                                        </Button>
                                                    ))}
                                            </div>
                                        )}
                                    </div>
                                )
                            })}
                    </nav>
                </ScrollArea>
            </div>

            {/* 右侧内容区域 */}
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                {/* 搜索栏 - 固定在顶部 */}
                <div className="shrink-0 pb-4">
                    <div className="relative">
                        <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                            <Search className="h-4 w-4 text-muted-foreground" />
                        </span>
                        <Input
                            placeholder="搜索导航..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-9"
                        />
                    </div>
                </div>

                {/* 内容区域 - 独立滚动 */}
                <div
                    ref={contentRef}
                    className="flex-1 overflow-y-auto pr-2"
                    onScroll={handleScroll}
                >
                    <div className="space-y-8 pb-8">
                        {visibleCategories.map((category) => {
                                const hasSubCategories =
                                    category.filteredSubCategories && category.filteredSubCategories.length > 0
                                const hasDirectItems = category.filteredDirectItems.length > 0
                                const filteredDirectItems = category.filteredDirectItems

                                return (
                                    <div
                                        key={category.id}
                                        ref={(el) => {
                                            if (el) {
                                                sectionRefs.current.set(category.id, el)
                                            } else {
                                                sectionRefs.current.delete(category.id)
                                            }
                                        }}
                                        className="scroll-mt-4"
                                    >
                                        {/* 分类标题 */}
                                        <div className="mb-4">
                                            <h2 className="text-xl font-bold">{category.title}</h2>
                                            {category.description && (
                                                <p className="text-muted-foreground text-sm mt-1">
                                                    {category.description}
                                                </p>
                                            )}
                                        </div>

                                        {/* 直接项目 */}
                                        {hasDirectItems && filteredDirectItems.length > 0 && (
                                            <div className="mb-6">
                                                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                                                    {filteredDirectItems.map((item) => (
                                                        <NavItemCard
                                                            key={item.id}
                                                            item={item}
                                                            categoryId={category.id}
                                                            subCategoryId={null}
                                                            onClick={() => handleOpenLink(item)}
                                                        />
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {/* 子分类 */}
                                        {hasSubCategories &&
                                            category.filteredSubCategories
                                                .map((subCategory) => {
                                                    const filteredItems = subCategory.items
                                                    if (filteredItems.length === 0) return null

                                                    return (
                                                        <div
                                                            key={subCategory.id}
                                                            ref={(el) => {
                                                                if (el) {
                                                                    sectionRefs.current.set(subCategory.id, el)
                                                                } else {
                                                                    sectionRefs.current.delete(subCategory.id)
                                                                }
                                                            }}
                                                            className="mb-6 scroll-mt-4"
                                                        >
                                                            <h3 className="text-base font-semibold text-muted-foreground mb-3">
                                                                {subCategory.title}
                                                            </h3>
                                                            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                                                                {filteredItems.map((item) => (
                                                                    <NavItemCard
                                                                        key={item.id}
                                                                        item={item}
                                                                        categoryId={category.id}
                                                                        subCategoryId={subCategory.id}
                                                                        onClick={() => handleOpenLink(item)}
                                                                    />
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )
                                                })}
                                    </div>
                                )
                            })}
                    </div>
                </div>
            </div>

            {/* 编辑对话框 */}
            <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
                <DialogContent className="sm:max-w-[500px]">
                    <DialogHeader>
                        <DialogTitle>编辑站点</DialogTitle>
                        <DialogDescription>修改站点信息</DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-4">
                        {/* 站点链接 */}
                        <div className="space-y-2">
                            <Label htmlFor="href">
                                站点链接 <span className="text-destructive">*</span>
                            </Label>
                            <Input
                                id="href"
                                value={editForm.href || ''}
                                onChange={(e) => setEditForm({ ...editForm, href: e.target.value })}
                                placeholder="输入网站链接"
                            />
                        </div>

                        {/* 站点名称 */}
                        <div className="space-y-2">
                            <Label htmlFor="title">
                                站点名称 <span className="text-destructive">*</span>
                            </Label>
                            <Input
                                id="title"
                                value={editForm.title || ''}
                                onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                                placeholder="站点名称"
                            />
                        </div>

                        {/* 站点图标 */}
                        <div className="space-y-2">
                            <Label htmlFor="icon">站点图标</Label>
                            <Input
                                id="icon"
                                value={editForm.icon || ''}
                                onChange={(e) => setEditForm({ ...editForm, icon: e.target.value })}
                                placeholder="图标 URL"
                            />
                            <p className="text-xs text-muted-foreground">
                                输入图标的 URL 地址
                            </p>
                        </div>

                        {/* 分类选择 */}
                        <div className="space-y-2">
                            <Label htmlFor="category">
                                分类 <span className="text-destructive">*</span>
                            </Label>
                            <Select
                                value={editCategoryId}
                                onValueChange={(v) => {
                                    setEditCategoryId(v)
                                    setEditSubCategoryId('')
                                }}
                            >
                                <SelectTrigger id="category">
                                    <SelectValue placeholder="选择分类" />
                                </SelectTrigger>
                                <SelectContent>
                                    {data.navigationItems.map((cat) => (
                                        <SelectItem key={cat.id} value={cat.id}>
                                            {cat.title}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {/* 子分类选择 */}
                        {data.navigationItems.find((c) => c.id === editCategoryId)?.subCategories?.length ? (
                            <div className="space-y-2">
                                <Label htmlFor="subcategory">子分类</Label>
                                <Select
                                    value={editSubCategoryId || 'none'}
                                    onValueChange={(v) => setEditSubCategoryId(v === 'none' ? '' : v)}
                                >
                                    <SelectTrigger id="subcategory">
                                        <SelectValue placeholder="选择子分类" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="none">无（直接放在分类下）</SelectItem>
                                        {data.navigationItems
                                            .find((c) => c.id === editCategoryId)
                                            ?.subCategories?.map((sub) => (
                                                <SelectItem key={sub.id} value={sub.id}>
                                                    {sub.title}
                                                </SelectItem>
                                            ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        ) : null}

                        {/* 默认浏览器 */}
                        <div className="space-y-2">
                            <Label htmlFor="browser">默认浏览器</Label>
                            <Select
                                value={editForm.browser || 'default'}
                                onValueChange={(v) =>
                                    setEditForm({
                                        ...editForm,
                                        browser: v as NavLinkItem['browser']
                                    })
                                }
                            >
                                <SelectTrigger id="browser">
                                    <SelectValue placeholder="选择浏览器" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="default">系统默认浏览器</SelectItem>
                                    <SelectItem value="chrome">Google Chrome</SelectItem>
                                    <SelectItem value="edge">Microsoft Edge</SelectItem>
                                    <SelectItem value="safari">Safari</SelectItem>
                                    <SelectItem value="firefox">Firefox</SelectItem>
                                </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground">
                                选择打开此站点时使用的浏览器
                            </p>
                        </div>

                        {/* 描述 */}
                        <div className="space-y-2">
                            <Label htmlFor="description">描述</Label>
                            <textarea
                                id="description"
                                value={editForm.description || ''}
                                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                                placeholder="输入站点描述（可选）"
                                rows={3}
                                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-none"
                            />
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
                            取消
                        </Button>
                        <Button
                            onClick={handleSaveEdit}
                            disabled={!editForm.title || !editForm.href || saving}
                        >
                            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            保存
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
