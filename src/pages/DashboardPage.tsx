import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DynamicGreeting } from '@/components/dashboard/DynamicGreeting'
import { TimePulseHeatmap } from '@/components/dashboard/TimePulseHeatmap'
import { QuickTools } from '@/components/dashboard/QuickTools'
import { VRMViewer } from '@/components/dashboard/VRMViewer'
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
    <div className="relative h-full flex w-full">
      
      {/* 1. Underlying Colorful Background to enhance Glassmorphism */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none -z-20">
        <div className="absolute top-[10%] left-[5%] w-[40%] h-[40%] rounded-full bg-violet-400/20 dark:bg-violet-600/30 blur-[100px]" />
        <div className="absolute bottom-[10%] left-[15%] w-[50%] h-[50%] rounded-full bg-cyan-400/10 dark:bg-cyan-600/20 blur-[100px]" />
      </div>

      {/* 2. Background Content (Full Width Avatar, Centered) */}
      <div className="absolute inset-0 flex justify-center items-center pointer-events-none z-0 overflow-hidden">
        
        {/* Subtle radial gradient behind avatar */}
        <div className="absolute inset-x-0 bottom-0 top-[20%] bg-[radial-gradient(ellipse_at_center,rgba(139,92,246,0.08),transparent_50%)] dark:bg-[radial-gradient(ellipse_at_center,rgba(139,92,246,0.15),transparent_50%)] pointer-events-none" />

        {/* 3D Character - Full Screen, will naturally be covered by left cards */}
        {enableVirtualAvatar && (
          <VRMViewer modelPath="./EVA.vrm" className="w-[120%] h-[120%] lg:w-[100%] translate-y-[5%] pointer-events-auto" />
        )}
      </div>

      {/* 3. Foreground Overlay (Left Stacked Cards) */}
      <div className="relative z-10 flex-1 flex flex-col w-full h-full p-8 lg:p-12 pointer-events-none overflow-y-auto overflow-x-hidden">
        
        <div className="pointer-events-auto mb-8">
          <DynamicGreeting />
        </div>

        {/* Stacked Cards Layout - Using Left 45% of width on large screens */}
        <div className="flex flex-col gap-8 w-full md:w-[70%] lg:w-[45%] xl:w-[40%] pb-12 pointer-events-auto relative">
          
          {/* Card 1: Time Pulse */}
          <Card 
            className="overflow-hidden transition-all duration-300 hover:-translate-y-1"
            style={{
              background: 'rgba(255, 255, 255, 0.6)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              border: '1px solid rgba(255, 255, 255, 0.3)',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.05)',
              borderRadius: '16px'
            }}
          >
            <CardHeader className="pb-4">
              <CardTitle className="text-base font-bold flex items-center gap-2 text-slate-800">
                <div className="h-2 w-2 rounded-full bg-violet-500 animate-pulse shadow-[0_0_8px_rgba(139,92,246,0.5)]" />
                今日时间脉动
              </CardTitle>
              <CardDescription className="text-slate-600">从活动追踪查看你的时间分布</CardDescription>
            </CardHeader>
            <CardContent>
              <TimePulseHeatmap />
            </CardContent>
          </Card>

          {/* Card 2: Quick Tools */}
          <Card 
            className="overflow-hidden transition-all duration-300 hover:-translate-y-1"
            style={{
              background: 'rgba(255, 255, 255, 0.6)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              border: '1px solid rgba(255, 255, 255, 0.3)',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.05)',
              borderRadius: '16px'
            }}
          >
            <CardHeader className="pb-4">
              <CardTitle className="text-base font-bold flex items-center gap-2 text-slate-800">
                <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                快捷工具面板
              </CardTitle>
              <CardDescription className="text-slate-600">最常用的工具，一键直达</CardDescription>
            </CardHeader>
            <CardContent>
              <QuickTools />
            </CardContent>
          </Card>

        </div>
      </div>

    </div>
  )
}
