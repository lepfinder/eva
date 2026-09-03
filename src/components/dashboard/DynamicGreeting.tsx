import { useMemo } from 'react'

export function DynamicGreeting(): React.ReactElement {
    const greeting = useMemo(() => {
        const hour = new Date().getHours()

        if (hour >= 5 && hour < 12) {
            return '早上好，开发者'
        } else if (hour >= 12 && hour < 18) {
            return '下午好，开发者'
        } else if (hour >= 18 && hour < 23) {
            return '晚上好，开发者'
        } else {
            return '夜深了，注意休息'
        }
    }, [])

    return (
        <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold text-zinc-900">
                {greeting}
            </h1>

            {/* EVA 脉冲动画 - 表示AI正在后台分析 */}
            <div className="relative flex items-center justify-center w-6 h-6">
                {/* 外层扩散环 */}
                <div className="absolute inset-0 rounded-full bg-violet-500/30 animate-ping" />

                {/* 中层呼吸环 */}
                <div className="absolute inset-1 rounded-full bg-violet-500/50 animate-pulse" />

                {/* 核心圆点 */}
                <div className="relative w-3 h-3 rounded-full bg-violet-500" />
            </div>
        </div>
    )
}
