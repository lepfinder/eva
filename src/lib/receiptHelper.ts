/**
 * 小票时间格式化与配平算法工具函数
 */

/**
 * 格式化秒数为简短字符串（如 3h 12m、45m 或 45s）
 */
export function formatDurationShort(seconds: number): string {
    if (seconds < 60) return `${Math.max(0, Math.round(seconds))}s`
    const hours = Math.floor(seconds / 3600)
    const mins = Math.floor((seconds % 3600) / 60)
    if (hours === 0) return `${mins}m`
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
}

/**
 * 格式化分钟数为简短字符串（如 3h 12m 或 45m）
 */
export function formatMinutes(mins: number): string {
    if (mins <= 0) return '0m'
    const hours = Math.floor(mins / 60)
    const m = mins % 60
    if (hours === 0) return `${m}m`
    return m > 0 ? `${hours}h ${m}m` : `${hours}h`
}

/**
 * 最大余数配平法 (Largest Remainder Method / Hare-Niemeyer)
 *
 * 保证各展示项（Top Apps + Misc）格式化后的分钟数相加，
 * 100% 精确等于小票底部 SUBTOTAL 展示的总时长。
 */
export function balanceReceiptDurations(
    itemDurations: number[],
    totalDuration: number
): {
    itemFormatted: string[]
    subtotalFormatted: string
} {
    if (itemDurations.length === 0) {
        return {
            itemFormatted: [],
            subtotalFormatted: formatDurationShort(totalDuration),
        }
    }

    // 如果全天总时长不足 60 秒，直接按秒显示
    if (totalDuration < 60) {
        return {
            itemFormatted: itemDurations.map(d => formatDurationShort(d)),
            subtotalFormatted: formatDurationShort(totalDuration),
        }
    }

    // 目标总分钟数（四舍五入取整）
    const targetTotalMins = Math.max(1, Math.round(totalDuration / 60))

    // 各项基准分钟数与余数秒
    const baseMins = itemDurations.map(d => Math.floor(d / 60))
    const currentSum = baseMins.reduce((a, b) => a + b, 0)
    let diff = targetTotalMins - currentSum

    // 按照余数秒从大到小排序，差额优先分配给最接近进位的项
    const remainders = itemDurations.map((d, index) => ({
        index,
        rem: d % 60,
        orig: d,
    }))

    remainders.sort((a, b) => {
        if (b.rem !== a.rem) return b.rem - a.rem
        return b.orig - a.orig
    })

    const finalMins = [...baseMins]
    for (let i = 0; i < remainders.length && diff > 0; i++) {
        finalMins[remainders[i].index] += 1
        diff -= 1
    }

    // 极特殊情况下若仍有余差（理论上不可能），分配给最大项
    if (diff > 0 && finalMins.length > 0) {
        finalMins[remainders[0].index] += diff
    }

    return {
        itemFormatted: finalMins.map(m => formatMinutes(m)),
        subtotalFormatted: formatMinutes(targetTotalMins),
    }
}

export interface AwayStats {
    totalDuration: number
    count: number
}

/**
 * 分析活动日志中的空白时段，提取工间休息 / 离席统计（排除夜间休眠与长时间离线）
 */
export function computeAwayStats(
    logs: Array<{ startTime: number; endTime: number }>,
    dateStr: string
): AwayStats {
    if (!logs || logs.length === 0) {
        return { totalDuration: 0, count: 0 }
    }

    const sortedLogs = [...logs].sort((a, b) => a.startTime - b.startTime)
    const dayStartMs = new Date(dateStr + 'T00:00:00').getTime()
    const dayEndMs = dayStartMs + 24 * 3600 * 1000
    const now = Date.now()
    const isToday = new Date().toDateString() === new Date(dateStr + 'T00:00:00').toDateString()
    const effectiveEndMs = isToday ? Math.min(now, dayEndMs) : dayEndMs

    const classifyGap = (gapStart: number, gapEnd: number) => {
        const durationSec = Math.round((gapEnd - gapStart) / 1000)
        if (durationSec < 600) return null // 小于10分钟忽略

        const startHour = new Date(gapStart).getHours()
        const endHour = new Date(gapEnd).getHours()

        // 1. 夜间睡眠判定
        const isNight = (startHour >= 23 || startHour < 6) && (endHour <= 9 || gapEnd - gapStart > 4 * 3600 * 1000)
        if (isNight && durationSec >= 3600) {
            return 'offline'
        }

        // 2. 超长离线（持续超过 3.5 小时）
        if (durationSec > 3.5 * 3600) {
            return 'offline'
        }

        // 3. 下班后离线判定
        const isAfterWork =
            (startHour >= 20 && durationSec >= 3600) ||
            (startHour >= 19 && durationSec >= 2 * 3600)
        if (isAfterWork) {
            return 'offline'
        }

        // 4. 正常工间离席
        return 'away'
    }

    let awayDurationSum = 0
    let awayCount = 0

    let curEnd = sortedLogs[0].endTime
    for (let i = 1; i < sortedLogs.length; i++) {
        const nextLog = sortedLogs[i]
        if (nextLog.startTime > curEnd + 10 * 60 * 1000) {
            if (classifyGap(curEnd, nextLog.startTime) === 'away') {
                const dur = Math.round((nextLog.startTime - curEnd) / 1000)
                awayDurationSum += dur
                awayCount += 1
            }
        }
        if (nextLog.endTime > curEnd) {
            curEnd = nextLog.endTime
        }
    }

    if (effectiveEndMs > curEnd + 10 * 60 * 1000) {
        if (classifyGap(curEnd, effectiveEndMs) === 'away') {
            const dur = Math.round((effectiveEndMs - curEnd) / 1000)
            awayDurationSum += dur
            awayCount += 1
        }
    }

    return { totalDuration: awayDurationSum, count: awayCount }
}

