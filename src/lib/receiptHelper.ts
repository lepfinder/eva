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
