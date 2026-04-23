interface ToolUsageStats {
    [toolId: string]: {
        count: number
        lastUsed: number
    }
}

interface ToolStat {
    id: string
    count: number
    lastUsed: number
}

const STORAGE_KEY = 'eva-tool-usage-stats'

/**
 * 记录工具使用
 */
export function recordToolUsage(toolId: string): void {
    const stats = getToolUsageStats()

    stats[toolId] = {
        count: (stats[toolId]?.count || 0) + 1,
        lastUsed: Date.now()
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(stats))
}

/**
 * 获取所有工具使用统计
 */
export function getToolUsageStats(): ToolUsageStats {
    try {
        const data = localStorage.getItem(STORAGE_KEY)
        return data ? JSON.parse(data) : {}
    } catch {
        return {}
    }
}

/**
 * 获取最常用的工具
 */
export function getMostUsedTools(limit: number = 6): ToolStat[] {
    const stats = getToolUsageStats()

    return Object.entries(stats)
        .map(([id, data]) => ({ id, ...data }))
        .sort((a, b) => b.count - a.count)
        .slice(0, limit)
}

/**
 * 清除所有统计数据
 */
export function clearToolUsageStats(): void {
    localStorage.removeItem(STORAGE_KEY)
}
