import { useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useTranslation } from 'react-i18next'
import {
  LayoutDashboard,
  Settings,
  Compass,
  Wrench,
  PanelLeft,
  Lock,
  Clipboard,
  Timer,
  MonitorPlay,
  Zap,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip'
import { Separator } from '@/components/ui/separator'
import logoImage from '@/assets/logo.png'

export type NavItem = 'dashboard' | 'navigation' | 'toolbox' | 'automation' | 'vault' | 'clipboard' | 'timeauditor' | 'visualrecall' | 'settings'

interface SidebarProps {
  activeNav: NavItem
  onNavChange: (nav: NavItem) => void
}

const navGroups = [
  {
    title: 'CORE',
    items: [
      { id: 'dashboard', labelKey: 'nav.dashboard', icon: <LayoutDashboard className="h-5 w-5" /> }
    ]
  },
  {
    title: 'ACTION',
    items: [
      { id: 'navigation', labelKey: 'nav.navigation', icon: <Compass className="h-5 w-5" /> },
      { id: 'automation', labelKey: 'nav.automation', icon: <Zap className="h-5 w-5" /> },
      { id: 'toolbox', labelKey: 'nav.toolbox', icon: <Wrench className="h-5 w-5" /> }
    ]
  },
  {
    title: 'MEMORY',
    items: [
      { id: 'clipboard', labelKey: 'nav.clipboard', icon: <Clipboard className="h-5 w-5" /> },
      { id: 'timeauditor', labelKey: 'nav.timeauditor', icon: <Timer className="h-5 w-5" /> },
      { id: 'visualrecall', labelKey: 'nav.visualrecall', icon: <MonitorPlay className="h-5 w-5" /> },
      { id: 'vault', labelKey: 'nav.vault', icon: <Lock className="h-5 w-5" /> }
    ]
  }
]

export function Sidebar({ activeNav, onNavChange }: SidebarProps): React.ReactElement {
  const { t } = useTranslation()
  const [collapsed, setCollapsed] = useState(false)

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        className={cn(
          'flex h-full flex-col border-r bg-card transition-all duration-300',
          collapsed ? 'w-16' : 'w-56'
        )}
      >
        {/* Header with drag region for macOS - 增加高度并为交通灯留空间 */}
        <div
          className="drag-region h-12 shrink-0"
          data-tauri-drag-region
          onMouseDown={() => getCurrentWindow().startDragging()}
        />
        <div className={cn("flex items-center px-4 pb-3", collapsed ? "justify-center" : "justify-between")}>
          {!collapsed && (
            <div className="no-drag flex items-center gap-3">
              <img src={logoImage} alt="EVA Logo" className="h-10 w-10 rounded-lg" />
              <div className="flex flex-col gap-0.5">
                <span className="text-lg font-bold tracking-[0.1em] text-zinc-900">
                  EVA
                </span>
                <span className="text-[10px] text-zinc-400 font-mono uppercase tracking-tighter">
                  LOCAL INTELLIGENCE
                </span>
              </div>
            </div>
          )}
          {collapsed && (
            <div className="no-drag mb-2">
              <img src={logoImage} alt="EVA Logo" className="h-10 w-10 rounded-lg" />
            </div>
          )}
          {!collapsed && (
            <Button
              variant="ghost"
              size="icon"
              className="no-drag h-8 w-8"
              onClick={() => setCollapsed(!collapsed)}
              title={collapsed ? t('common.expand') : t('common.collapse')}
            >
              <PanelLeft className="h-4 w-4" />
            </Button>
          )}
        </div>
        {collapsed && (
          <div className="flex justify-center pb-2">
            <Button
              variant="ghost"
              size="icon"
              className="no-drag h-8 w-8"
              onClick={() => setCollapsed(!collapsed)}
              title={t('common.expand')}
            >
              <PanelLeft className="h-4 w-4" />
            </Button>
          </div>
        )}

        <Separator />

        {/* Navigation */}
        {/* Navigation */}
        <nav className="flex-1 space-y-4 px-2 py-2 overflow-y-auto scrollbar-none">
          {navGroups.map((group, groupIndex) => (
            <div key={group.title} className={cn(!collapsed && "space-y-1")}>
              {!collapsed && (
                <h4 className="px-2 text-[10px] font-bold text-muted-foreground/50 tracking-wider mb-1 uppercase font-mono">
                  {group.title}
                </h4>
              )}
              {collapsed && groupIndex > 0 && <Separator className="my-2" />}
              <div className="space-y-1">
                {group.items.map((item) => (
                  <Tooltip key={item.id}>
                    <TooltipTrigger asChild>
                      <Button
                        variant={activeNav === item.id ? 'secondary' : 'ghost'}
                        className={cn(
                          'w-full justify-start gap-3 h-9',
                          collapsed ? 'justify-center px-0' : 'px-3'
                        )}
                        onClick={() => onNavChange(item.id as NavItem)}
                      >
                        {item.icon}
                        {!collapsed && <span className="text-sm font-medium">{t(item.labelKey)}</span>}
                      </Button>
                    </TooltipTrigger>
                    {collapsed && (
                      <TooltipContent side="right">
                        <p>{t(item.labelKey)}</p>
                      </TooltipContent>
                    )}
                  </Tooltip>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <Separator />

        {/* Settings at bottom */}
        <div className="p-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={activeNav === 'settings' ? 'secondary' : 'ghost'}
                className={cn(
                  'w-full justify-start gap-3',
                  collapsed && 'justify-center px-2'
                )}
                onClick={() => onNavChange('settings')}
              >
                <Settings className="h-5 w-5" />
                {!collapsed && <span>{t('nav.settings')}</span>}
              </Button>
            </TooltipTrigger>
            {collapsed && (
              <TooltipContent side="right">
                <p>{t('nav.settings')}</p>
              </TooltipContent>
            )}
          </Tooltip>
        </div>
      </aside>
    </TooltipProvider>
  )
}
