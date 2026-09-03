import { DynamicGreeting } from '@/components/dashboard/DynamicGreeting'
import { TimePulseHeatmap } from '@/components/dashboard/TimePulseHeatmap'
import { QuickTools } from '@/components/dashboard/QuickTools'
import { QuickClipsCard } from '@/components/dashboard/QuickClipsCard'
import { VRMViewer } from '@/components/dashboard/VRMViewer'
import { EvaSpeechBubble } from '@/components/dashboard/EvaSpeechBubble'
// @ts-ignore
import evaModel from '@/assets/EVA.vrm'
import { useState, useEffect } from 'react'

export function DashboardPage(): React.ReactElement {
  const [enableVirtualAvatar, setEnableVirtualAvatar] = useState(true)

  useEffect(() => {
    window.api.settingsGetAll().then(settings => {
      if (settings && typeof settings.enableVirtualAvatar === 'boolean') {
        setEnableVirtualAvatar(settings.enableVirtualAvatar)
      }
    })
  }, [])

  return (
    <div className="relative h-full flex w-full select-none overflow-hidden">
      
      {/* 1. 环境彩色光斑 - 增强整体通透毛玻璃氛围 */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none -z-20">
        <div className="absolute top-[8%] left-[8%] w-[38%] h-[38%] rounded-full bg-violet-400/25 dark:bg-violet-600/35 blur-[120px]" />
        <div className="absolute bottom-[12%] left-[12%] w-[45%] h-[45%] rounded-full bg-cyan-400/15 dark:bg-cyan-600/25 blur-[120px]" />
      </div>

      {/* 2. 背景 3D EVA 角色与环境光晕层 */}
      <div className="absolute inset-0 flex justify-center items-center pointer-events-none z-0 overflow-hidden">
        {/* EVA 角色身后专属的环境径向光晕 (Ambient Glow) */}
        <div className="absolute inset-x-0 bottom-0 top-[10%] bg-[radial-gradient(ellipse_at_68%_45%,rgba(139,92,246,0.15)_0%,rgba(59,130,246,0.06)_38%,transparent_68%)] dark:bg-[radial-gradient(ellipse_at_68%_45%,rgba(139,92,246,0.22)_0%,rgba(59,130,246,0.1)_38%,transparent_68%)] pointer-events-none" />

        {/* 角色底托柔和投影，增强站立沉浸感 */}
        <div className="absolute bottom-4 right-[25%] w-[320px] h-[36px] bg-[radial-gradient(ellipse_at_center,rgba(0,0,0,0.08)_0%,transparent_70%)] dark:bg-[radial-gradient(ellipse_at_center,rgba(0,0,0,0.4)_0%,transparent_70%)] pointer-events-none blur-sm" />

        {/* 3D EVA 虚拟角色 */}
        {enableVirtualAvatar && (
          <VRMViewer modelPath="/EVA.vrm" className="w-[120%] h-[120%] lg:w-[100%] translate-y-[5%] pointer-events-auto" />
        )}
      </div>

      {/* 3. 前台交互与数据卡片层 */}
      <div className="relative z-10 flex-1 flex flex-col w-full h-full p-8 lg:p-12 pointer-events-none overflow-y-auto overflow-x-hidden">
        
        {/* 顶部主问候语 */}
        <div className="pointer-events-auto mb-6 flex items-center justify-between">
          <DynamicGreeting />
        </div>

        {/* EVA 智能伴侣感知气泡 (悬浮于角色头顶右上侧舒适留白区) */}
        {enableVirtualAvatar && (
          <div className="absolute top-[8%] right-[8%] xl:right-[11%] z-20 pointer-events-auto hidden md:block">
            <EvaSpeechBubble />
          </div>
        )}

        {/* 左侧卡片流 - 宽度占大屏 42%，保证右侧 EVA 完整且通透 */}
        <div className="flex flex-col gap-4 w-full md:w-[68%] lg:w-[44%] xl:w-[40%] pb-12 pointer-events-auto relative">
          
          {/* Card 1: 今日效率微仪表 */}
          <div 
            className="p-5 rounded-2xl transition-all duration-300 hover:-translate-y-0.5"
            style={{
              background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.78) 0%, rgba(255, 255, 255, 0.52) 100%)',
              backdropFilter: 'blur(24px)',
              WebkitBackdropFilter: 'blur(24px)',
              border: '1px solid rgba(255, 255, 255, 0.65)',
              boxShadow: '0 12px 36px -4px rgba(0, 0, 0, 0.05), 0 4px 16px -2px rgba(0, 0, 0, 0.02)',
            }}
          >
            <TimePulseHeatmap />
          </div>

          {/* Card 2: 快捷工具极轻量胶囊栏 (Dock Pills) */}
          <div 
            className="p-4 rounded-2xl transition-all duration-300 hover:-translate-y-0.5"
            style={{
              background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.78) 0%, rgba(255, 255, 255, 0.52) 100%)',
              backdropFilter: 'blur(24px)',
              WebkitBackdropFilter: 'blur(24px)',
              border: '1px solid rgba(255, 255, 255, 0.65)',
              boxShadow: '0 12px 36px -4px rgba(0, 0, 0, 0.05), 0 4px 16px -2px rgba(0, 0, 0, 0.02)',
            }}
          >
            <QuickTools />
          </div>

          {/* Card 3: 最近剪贴板暂存 (Quick Clips) */}
          <div 
            className="p-4 rounded-2xl transition-all duration-300 hover:-translate-y-0.5"
            style={{
              background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.78) 0%, rgba(255, 255, 255, 0.52) 100%)',
              backdropFilter: 'blur(24px)',
              WebkitBackdropFilter: 'blur(24px)',
              border: '1px solid rgba(255, 255, 255, 0.65)',
              boxShadow: '0 12px 36px -4px rgba(0, 0, 0, 0.05), 0 4px 16px -2px rgba(0, 0, 0, 0.02)',
            }}
          >
            <QuickClipsCard />
          </div>

        </div>
      </div>

    </div>
  )
}
