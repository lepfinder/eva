import * as React from 'react'
import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import {
    Calendar as CalendarIcon,
    ChevronLeft,
    ChevronRight,
    ChevronsLeft,
    ChevronsRight,
    RotateCcw
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

export interface DatePickerProps {
    value?: Date | string
    onChange?: (date: Date, dateStr: string) => void
    maxDate?: Date
    minDate?: Date
    className?: string
    placeholder?: string
    disabled?: boolean
    align?: 'left' | 'center' | 'right'
}

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']
const MONTH_NAMES = [
    '1月', '2月', '3月', '4月', '5月', '6月',
    '7月', '8月', '9月', '10月', '11月', '12月'
]

function toLocalDateStr(d: Date): string {
    const year = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
}

function normalizeDate(d: Date | string | undefined): Date {
    if (!d) return new Date()
    if (typeof d === 'string') {
        const parts = d.split('-').map(Number)
        if (parts.length === 3) {
            return new Date(parts[0], parts[1] - 1, parts[2])
        }
        return new Date(d)
    }
    return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function isSameDay(a: Date, b: Date): boolean {
    return (
        a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate()
    )
}

function isBeforeDay(a: Date, b: Date): boolean {
    const da = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime()
    const db = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime()
    return da < db
}

function isAfterDay(a: Date, b: Date): boolean {
    const da = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime()
    const db = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime()
    return da > db
}

function formatHumanDate(date: Date): { text: string; tag?: string } {
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    const beforeYesterday = new Date(today)
    beforeYesterday.setDate(beforeYesterday.getDate() - 2)

    const year = date.getFullYear()
    const month = date.getMonth() + 1
    const day = date.getDate()
    const weekMap = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
    const weekday = weekMap[date.getDay()]

    const isCurrentYear = year === today.getFullYear()
    const dateStr = isCurrentYear ? `${month}月${day}日` : `${year}年${month}月${day}日`

    if (isSameDay(date, today)) {
        return { text: `${dateStr} · ${weekday}`, tag: '今天' }
    }
    if (isSameDay(date, yesterday)) {
        return { text: `${dateStr} · ${weekday}`, tag: '昨天' }
    }
    if (isSameDay(date, beforeYesterday)) {
        return { text: `${dateStr} · ${weekday}`, tag: '前天' }
    }
    return { text: `${dateStr} · ${weekday}` }
}

export const DatePicker: React.FC<DatePickerProps> = ({
    value,
    onChange,
    maxDate = new Date(),
    minDate,
    className,
    disabled = false,
    align = 'left'
}) => {
    const [isOpen, setIsOpen] = useState(false)
    const triggerRef = useRef<HTMLButtonElement>(null)
    const panelRef = useRef<HTMLDivElement>(null)
    const [coords, setCoords] = useState<{ top: number; left: number }>({ top: 0, left: 0 })

    const selected = useMemo(() => normalizeDate(value), [value])
    const today = useMemo(() => new Date(), [])

    const [viewYear, setViewYear] = useState<number>(selected.getFullYear())
    const [viewMonth, setViewMonth] = useState<number>(selected.getMonth())

    const updatePosition = useCallback(() => {
        if (!triggerRef.current) return
        const rect = triggerRef.current.getBoundingClientRect()
        const panelWidth = 288 // 72 * 4 = 288px
        let left = rect.left
        if (align === 'right') {
            left = rect.right - panelWidth
        } else if (align === 'center') {
            left = rect.left + rect.width / 2 - panelWidth / 2
        }
        if (left + panelWidth > window.innerWidth - 12) {
            left = window.innerWidth - panelWidth - 12
        }
        if (left < 12) left = 12

        setCoords({
            top: rect.bottom + 6,
            left
        })
    }, [align])

    // 每次打开同步月份视图到当前选中日期并更新位置
    useEffect(() => {
        if (isOpen) {
            setViewYear(selected.getFullYear())
            setViewMonth(selected.getMonth())
            updatePosition()
            window.addEventListener('resize', updatePosition)
            window.addEventListener('scroll', updatePosition, true)
            return () => {
                window.removeEventListener('resize', updatePosition)
                window.removeEventListener('scroll', updatePosition, true)
            }
        }
    }, [isOpen, selected, updatePosition])

    // 点击外部关闭
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            const target = e.target as Node
            const isClickTrigger = triggerRef.current && triggerRef.current.contains(target)
            const isClickPanel = panelRef.current && panelRef.current.contains(target)
            if (!isClickTrigger && !isClickPanel) {
                setIsOpen(false)
            }
        }
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setIsOpen(false)
        }

        if (isOpen) {
            document.addEventListener('pointerdown', handleClickOutside)
            document.addEventListener('keydown', handleKeyDown)
        }
        return () => {
            document.removeEventListener('pointerdown', handleClickOutside)
            document.removeEventListener('keydown', handleKeyDown)
        }
    }, [isOpen])

    const calendarGrid = useMemo(() => {
        const firstDayOfMonth = new Date(viewYear, viewMonth, 1)
        const lastDayOfMonth = new Date(viewYear, viewMonth + 1, 0)

        // 星期一为每周起始日：0=周日，1=周一 ... 6=周六
        const startDayIndex = (firstDayOfMonth.getDay() + 6) % 7
        const totalDays = lastDayOfMonth.getDate()

        const days: Array<{
            date: Date
            isCurrentMonth: boolean
            isToday: boolean
            isSelected: boolean
            isDisabled: boolean
        }> = []

        // 上个月补齐
        const prevMonthLastDate = new Date(viewYear, viewMonth, 0).getDate()
        for (let i = startDayIndex - 1; i >= 0; i--) {
            const date = new Date(viewYear, viewMonth - 1, prevMonthLastDate - i)
            days.push({
                date,
                isCurrentMonth: false,
                isToday: isSameDay(date, today),
                isSelected: isSameDay(date, selected),
                isDisabled: (maxDate && isAfterDay(date, maxDate)) || (minDate && isBeforeDay(date, minDate)) || false
            })
        }

        // 当月
        for (let day = 1; day <= totalDays; day++) {
            const date = new Date(viewYear, viewMonth, day)
            days.push({
                date,
                isCurrentMonth: true,
                isToday: isSameDay(date, today),
                isSelected: isSameDay(date, selected),
                isDisabled: (maxDate && isAfterDay(date, maxDate)) || (minDate && isBeforeDay(date, minDate)) || false
            })
        }

        // 下个月补齐为 42 格 (6 行)
        const remaining = 42 - days.length
        for (let day = 1; day <= remaining; day++) {
            const date = new Date(viewYear, viewMonth + 1, day)
            days.push({
                date,
                isCurrentMonth: false,
                isToday: isSameDay(date, today),
                isSelected: isSameDay(date, selected),
                isDisabled: (maxDate && isAfterDay(date, maxDate)) || (minDate && isBeforeDay(date, minDate)) || false
            })
        }

        return days
    }, [viewYear, viewMonth, selected, today, maxDate, minDate])

    const handlePrevMonth = () => {
        if (viewMonth === 0) {
            setViewYear(viewYear - 1)
            setViewMonth(11)
        } else {
            setViewMonth(viewMonth - 1)
        }
    }

    const handleNextMonth = () => {
        if (viewMonth === 11) {
            setViewYear(viewYear + 1)
            setViewMonth(0)
        } else {
            setViewMonth(viewMonth + 1)
        }
    }

    const handlePrevYear = () => setViewYear(y => y - 1)
    const handleNextYear = () => setViewYear(y => y + 1)

    const handleSelectDay = (date: Date, isDisabled: boolean) => {
        if (isDisabled || disabled) return
        onChange?.(date, toLocalDateStr(date))
        setIsOpen(false)
    }

    const handleQuickSelect = (daysAgo: number) => {
        const target = new Date()
        target.setDate(target.getDate() - daysAgo)
        if (maxDate && isAfterDay(target, maxDate)) return
        if (minDate && isBeforeDay(target, minDate)) return
        onChange?.(target, toLocalDateStr(target))
        setIsOpen(false)
    }

    const formatted = formatHumanDate(selected)

    return (
        <div className={cn('relative inline-block', className)}>
            {/* 触发器按钮 */}
            <button
                ref={triggerRef}
                type="button"
                disabled={disabled}
                onClick={() => setIsOpen(prev => !prev)}
                className={cn(
                    'group flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border/80 bg-background/80 hover:bg-muted/60 text-foreground transition-all duration-150 select-none shadow-xs text-xs font-medium cursor-pointer',
                    isOpen && 'border-primary/50 ring-2 ring-primary/10 shadow-sm',
                    disabled && 'opacity-50 cursor-not-allowed'
                )}
            >
                <CalendarIcon className="h-3.5 w-3.5 text-primary shrink-0 transition-transform group-hover:scale-110" />
                <span className="font-semibold tracking-tight whitespace-nowrap">
                    {formatted.text}
                </span>
                {formatted.tag && (
                    <span className="text-[10px] leading-none px-1.5 py-0.5 rounded bg-primary/10 text-primary font-bold">
                        {formatted.tag}
                    </span>
                )}
            </button>

            {/* 下拉日历面板 (通过 Portal 挂载到 body，确保最高层级并不受父容器/兄弟组件 backdrop-blur 遮挡) */}
            {createPortal(
                <AnimatePresence>
                    {isOpen && (
                        <div
                            ref={panelRef}
                            style={{
                                position: 'fixed',
                                top: coords.top,
                                left: coords.left,
                                zIndex: 99999
                            }}
                        >
                            <motion.div
                                initial={{ opacity: 0, scale: 0.96, y: -6 }}
                                animate={{ opacity: 1, scale: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 0.96, y: -6 }}
                                transition={{ duration: 0.12, ease: 'easeOut' }}
                                className="p-3.5 w-72 rounded-2xl border border-border bg-popover text-popover-foreground shadow-2xl ring-1 ring-black/10 dark:ring-white/10 select-none"
                            >
                        {/* 头部年份与月份切换 */}
                        <div className="flex items-center justify-between gap-1 mb-2 px-0.5">
                            <div className="flex items-center gap-0.5">
                                <button
                                    type="button"
                                    onClick={handlePrevYear}
                                    title="上一年"
                                    className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                                >
                                    <ChevronsLeft className="h-3.5 w-3.5" />
                                </button>
                                <button
                                    type="button"
                                    onClick={handlePrevMonth}
                                    title="上一月"
                                    className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                                >
                                    <ChevronLeft className="h-3.5 w-3.5" />
                                </button>
                            </div>

                            <div className="text-xs font-semibold text-foreground tracking-tight select-none">
                                {viewYear} 年 {MONTH_NAMES[viewMonth]}
                            </div>

                            <div className="flex items-center gap-0.5">
                                <button
                                    type="button"
                                    onClick={handleNextMonth}
                                    title="下一月"
                                    className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                                >
                                    <ChevronRight className="h-3.5 w-3.5" />
                                </button>
                                <button
                                    type="button"
                                    onClick={handleNextYear}
                                    title="下一年"
                                    className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                                >
                                    <ChevronsRight className="h-3.5 w-3.5" />
                                </button>
                            </div>
                        </div>

                        {/* 星期表头 */}
                        <div className="grid grid-cols-7 mb-1 text-center">
                            {WEEKDAYS.map((w, idx) => (
                                <span
                                    key={w}
                                    className={cn(
                                        'text-[11px] font-medium py-1 select-none',
                                        idx >= 5 ? 'text-muted-foreground/60' : 'text-muted-foreground'
                                    )}
                                >
                                    {w}
                                </span>
                            ))}
                        </div>

                        {/* 日历格子网格 */}
                        <div className="grid grid-cols-7 gap-y-1 gap-x-0.5 text-center">
                            {calendarGrid.map((item, index) => {
                                const isCurrent = item.isCurrentMonth
                                return (
                                    <button
                                        key={index}
                                        type="button"
                                        disabled={item.isDisabled}
                                        onClick={() => handleSelectDay(item.date, item.isDisabled)}
                                        className={cn(
                                            'relative h-8 w-8 mx-auto flex items-center justify-center rounded-xl text-xs font-medium transition-all duration-120 select-none cursor-pointer',
                                            // 非本月
                                            !isCurrent && 'text-muted-foreground/30',
                                            // 本月常规
                                            isCurrent && !item.isSelected && 'text-foreground hover:bg-muted/80',
                                            // 选中状态
                                            item.isSelected &&
                                                'bg-primary text-primary-foreground font-semibold shadow-sm hover:bg-primary/95',
                                            // 禁用状态
                                            item.isDisabled &&
                                                'opacity-20 cursor-not-allowed hover:bg-transparent text-muted-foreground line-through'
                                        )}
                                    >
                                        <span>{item.date.getDate()}</span>
                                        {/* 今天小圆点指示 */}
                                        {item.isToday && !item.isSelected && (
                                            <span className="absolute bottom-1 w-1 h-1 rounded-full bg-primary" />
                                        )}
                                    </button>
                                )
                            })}
                        </div>

                        {/* 底部快捷操作栏 */}
                        <div className="mt-2.5 pt-2 border-t border-border/60 flex items-center justify-between text-[11px]">
                            <div className="flex items-center gap-1">
                                <button
                                    type="button"
                                    onClick={() => handleQuickSelect(0)}
                                    className={cn(
                                        'px-2 py-0.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors font-medium',
                                        isSameDay(selected, today) && 'text-primary font-bold bg-primary/10'
                                    )}
                                >
                                    今天
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleQuickSelect(1)}
                                    className="px-2 py-0.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors font-medium"
                                >
                                    昨天
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleQuickSelect(2)}
                                    className="px-2 py-0.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors font-medium"
                                >
                                    前天
                                </button>
                            </div>
                            <button
                                type="button"
                                onClick={() => handleQuickSelect(7)}
                                className="px-2 py-0.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors font-medium"
                            >
                                7天前
                            </button>
                        </div>
                            </motion.div>
                        </div>
                    )}
                </AnimatePresence>,
                document.body
            )}
        </div>
    )
}

export interface DateNavigatorProps {
    value: Date | string
    onChange: (date: Date, dateStr: string) => void
    maxDate?: Date
    minDate?: Date
    className?: string
    showTodayButton?: boolean
}

/**
 * 现代一体化紧凑日期导航胶囊组件：
 * [ < 前一天 ] [ 📅 9月2日 周三 · 今天 ] [ 后一天 > ] [ 今天 ]
 */
export const DateNavigator: React.FC<DateNavigatorProps> = ({
    value,
    onChange,
    maxDate = new Date(),
    minDate,
    className,
    showTodayButton = true
}) => {
    const selected = useMemo(() => normalizeDate(value), [value])
    const today = useMemo(() => new Date(), [])

    const isToday = isSameDay(selected, today)
    const isAtMax = maxDate ? isSameDay(selected, maxDate) || isAfterDay(selected, maxDate) : false
    const isAtMin = minDate ? isSameDay(selected, minDate) || isBeforeDay(selected, minDate) : false

    const handlePrev = () => {
        const prev = new Date(selected)
        prev.setDate(prev.getDate() - 1)
        if (minDate && isBeforeDay(prev, minDate)) return
        onChange(prev, toLocalDateStr(prev))
    }

    const handleNext = () => {
        const next = new Date(selected)
        next.setDate(next.getDate() + 1)
        if (maxDate && isAfterDay(next, maxDate)) return
        onChange(next, toLocalDateStr(next))
    }

    const handleGoToday = () => {
        const now = new Date()
        onChange(now, toLocalDateStr(now))
    }

    return (
        <div className={cn('inline-flex items-center gap-1.5', className)}>
            {/* 紧凑胶囊组件组 */}
            <div className="inline-flex items-center rounded-xl border border-border/70 bg-card/70 backdrop-blur-md p-0.5 shadow-xs transition-colors hover:border-border">
                {/* 前一天 */}
                <button
                    type="button"
                    onClick={handlePrev}
                    disabled={isAtMin}
                    title="前一天"
                    className="h-7 w-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/80 disabled:opacity-30 disabled:pointer-events-none transition-colors"
                >
                    <ChevronLeft className="h-3.5 w-3.5" />
                </button>

                {/* 日期选择器 Popover */}
                <DatePicker
                    value={selected}
                    onChange={onChange}
                    maxDate={maxDate}
                    minDate={minDate}
                    className="mx-0.5"
                />

                {/* 后一天 */}
                <button
                    type="button"
                    onClick={handleNext}
                    disabled={isAtMax}
                    title="后一天"
                    className="h-7 w-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/80 disabled:opacity-30 disabled:pointer-events-none transition-colors"
                >
                    <ChevronRight className="h-3.5 w-3.5" />
                </button>
            </div>

            {/* 快速返回今天按钮 */}
            {showTodayButton && !isToday && (
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleGoToday}
                    className="h-8 px-2.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent gap-1 rounded-xl transition-all"
                    title="跳转至今天"
                >
                    <RotateCcw className="h-3 w-3" />
                    <span>今天</span>
                </Button>
            )}
        </div>
    )
}
