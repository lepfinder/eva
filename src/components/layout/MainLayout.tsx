import { useState, useEffect, useCallback } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { Sidebar, NavItem } from './Sidebar'
import { DashboardPage } from '@/pages/DashboardPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { NavigationPage } from '@/pages/NavigationPage'
import { ToolboxPage } from '@/pages/ToolboxPage'
import { VaultPage } from '@/pages/VaultPage'
import { ClipboardHistoryPage } from '@/pages/ClipboardHistoryPage'
import { TimeAuditorPage } from '@/pages/TimeAuditorPage'
import { VisualRecallPage } from '@/pages/VisualRecallPage'
import { AutomationPage } from '@/pages/AutomationPage'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { Link, ExternalLink } from 'lucide-react'

// 导航项到中文名称的映射
const NAV_TITLE_MAP: Record<NavItem, string> = {
  dashboard: '仪表盘',
  navigation: '网站导航',
  toolbox: '工具箱',
  automation: '自动化工具',
  vault: '安全保险箱',
  clipboard: '剪贴板历史',
  timeauditor: '时间审计',
  visualrecall: '视觉回溯',
  settings: '设置'
}

export function MainLayoutContents(): React.ReactElement {
  const [activeNav, setActiveNav] = useState<NavItem>('dashboard')
  const [clipboardUrl, setClipboardUrl] = useState<string | null>(null)
  const [showUrlDialog, setShowUrlDialog] = useState(false)
  // 用于传递给 NavigationPage 的待添加 URL
  const [pendingAddUrl, setPendingAddUrl] = useState<string | null>(null)
  // 子工具标题后缀（用于 Toolbox 等页面）
  const [subTitle, setSubTitle] = useState<string | null>(null)

  // 动态更新窗口标题
  useEffect(() => {
    const baseName = 'EVA'
    const navName = NAV_TITLE_MAP[activeNav] || activeNav
    if (subTitle) {
      document.title = `${baseName} | ${navName} | ${subTitle}`
    } else {
      document.title = `${baseName} | ${navName}`
    }
  }, [activeNav, subTitle])

  // 当切换模块时，重置子标题
  useEffect(() => {
    setSubTitle(null)
  }, [activeNav])


  // 监听剪贴板 URL 检测
  useEffect(() => {
    const cleanup = window.api.onClipboardUrlDetected((url) => {
      console.log('[MainLayout] Clipboard URL detected:', url)
      setClipboardUrl(url)
      setShowUrlDialog(true)
    })

    return cleanup
  }, [])

  // 监听快捷键导航事件
  useEffect(() => {
    const cleanup = window.api.navigate.onHotkey((path) => {
      console.log('[MainLayout] Hotkey navigate to:', path)
      // 根据路径映射到 NavItem
      const pathToNav: Record<string, NavItem> = {
        '/vault': 'vault',
        '/time-auditor': 'timeauditor',
        '/clipboard': 'clipboard',
        '/settings': 'settings',
        '/dashboard': 'dashboard',
        '/navigation': 'navigation',
        '/toolbox': 'toolbox',
        '/visual-recall': 'visualrecall'
      }
      const navItem = pathToNav[path]
      if (navItem) {
        setActiveNav(navItem)
      }
    })

    return cleanup
  }, [])

  // 监听工具快捷入口的导航事件
  useEffect(() => {
    const handleNavigateToTool = (e: Event) => {
      const customEvent = e as CustomEvent<{ toolId: string }>
      const toolId = customEvent.detail?.toolId

      if (toolId) {
        // 切换到工具箱页面
        setActiveNav('toolbox')

        // 稍后发送工具切换事件给ToolboxPage
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('open-tool', {
            detail: { toolId }
          }))
        }, 100)
      }
    }

    window.addEventListener('navigate-to-tool', handleNavigateToTool)
    return () => window.removeEventListener('navigate-to-tool', handleNavigateToTool)
  }, [])

  // 处理添加站点
  const handleAddSite = useCallback(() => {
    if (clipboardUrl) {
      // 设置待添加 URL，切换到导航页面
      setPendingAddUrl(clipboardUrl)
      setActiveNav('navigation')
    }
    setShowUrlDialog(false)
    setClipboardUrl(null)
  }, [clipboardUrl])

  // 清除待添加 URL（NavigationPage 处理完后调用）
  const clearPendingAddUrl = useCallback(() => {
    setPendingAddUrl(null)
  }, [])

  // 取消
  const handleCancel = useCallback(() => {
    setShowUrlDialog(false)
    setClipboardUrl(null)
  }, [])

  // 提取域名用于显示
  const getDomain = (url: string): string => {
    try {
      return new URL(url).hostname
    } catch {
      return url
    }
  }

  const renderPage = (): React.ReactElement => {
    switch (activeNav) {
      case 'dashboard':
        return <DashboardPage />

      case 'navigation':
        return (
          <NavigationPage
            pendingAddUrl={pendingAddUrl}
            onPendingAddUrlHandled={clearPendingAddUrl}
          />
        )
      case 'toolbox':
        return <ToolboxPage onSubTitleChange={setSubTitle} />
      case 'automation':
        return <AutomationPage />
      case 'vault':
        return <VaultPage />
      case 'clipboard':
        return <ClipboardHistoryPage />
      case 'timeauditor':
        return <TimeAuditorPage />
      case 'visualrecall':
        return <VisualRecallPage />

      case 'settings':
        return <SettingsPage />
      default:
        return <DashboardPage />
    }
  }

  const isFullHeightPage = activeNav === 'dashboard' || activeNav === 'navigation' || activeNav === 'toolbox' || activeNav === 'automation' || activeNav === 'vault' || activeNav === 'clipboard' || activeNav === 'timeauditor' || activeNav === 'visualrecall'

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background">
      <Sidebar activeNav={activeNav} onNavChange={setActiveNav} />
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* 顶部可拖动区域 */}
        <div
          className="drag-region h-12 shrink-0 border-b bg-background"
          data-tauri-drag-region
          onMouseDown={() => getCurrentWindow().startDragging()}
        />
        {isFullHeightPage ? (
          // 导航页面/工具箱：完全填满，自己管理滚动
          <main className="flex-1 overflow-hidden p-6">
            {renderPage()}
          </main>
        ) : (
          // 其他页面：保持原有滚动行为
          <main className="flex-1 overflow-auto">
            <div className="p-6">{renderPage()}</div>
          </main>
        )}
      </div>

      {/* 剪贴板 URL 检测弹窗 */}
      <AlertDialog open={showUrlDialog} onOpenChange={setShowUrlDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Link className="h-5 w-5 text-primary" />
              检测到链接
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <p>剪贴板中检测到网站链接，是否要添加到站点导航？</p>
              <div className="flex items-center gap-2 rounded-lg bg-muted p-3">
                <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-foreground">
                    {clipboardUrl ? getDomain(clipboardUrl) : ''}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {clipboardUrl}
                  </p>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleCancel}>不了，谢谢</AlertDialogCancel>
            <AlertDialogAction onClick={handleAddSite}>添加站点</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export function MainLayout(): React.ReactElement {
  return <MainLayoutContents />
}
