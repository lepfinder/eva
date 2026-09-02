/**
 * 真实 Code 39 标准工业条形码组件
 * 真实可扫描、高密度、高拟真度热敏小票条码
 */
import { useMemo } from 'react'

const CODE39_MAP: Record<string, string> = {
    '0': '000110100',
    '1': '100100001',
    '2': '001100001',
    '3': '101100000',
    '4': '000110001',
    '5': '100110000',
    '6': '001110000',
    '7': '000100101',
    '8': '100100100',
    '9': '001100100',
    'A': '100001001',
    'B': '001001001',
    'C': '101001000',
    'D': '000011001',
    'E': '100011000',
    'F': '001011000',
    'G': '000001101',
    'H': '100001100',
    'I': '001001100',
    'J': '000011100',
    'K': '100000011',
    'L': '001000011',
    'M': '101000010',
    'N': '000010011',
    'O': '100010010',
    'P': '001010010',
    'Q': '000000111',
    'R': '100000110',
    'S': '001000110',
    'T': '000010110',
    'U': '110000001',
    'V': '011000001',
    'W': '111000000',
    'X': '010010001',
    'Y': '110010000',
    'Z': '011010000',
    '-': '010000101',
    '.': '110000100',
    ' ': '011000100',
    '$': '010101000',
    '/': '010100010',
    '+': '010001010',
    '%': '000101010',
    '*': '010010100' // 起始与终止符
}

interface BarcodeProps {
    value: string
    height?: number
    narrowWidth?: number
    wideRatio?: number
    className?: string
}

export function Barcode({
    value,
    height = 28,
    narrowWidth = 1.2,
    wideRatio = 2.4,
    className = ''
}: BarcodeProps) {
    const wideWidth = narrowWidth * wideRatio

    // 将文本转化为标准的 Code 39 条块段
    const bars = useMemo(() => {
        const clean = `*${value.toUpperCase().replace(/[^0-9A-Z\-\. \$\/\+\%]/g, '')}*`
        const elements: Array<{ isBlack: boolean; width: number }> = []

        for (let i = 0; i < clean.length; i++) {
            const char = clean[i]
            const pattern = CODE39_MAP[char] || CODE39_MAP['-']

            // 9 位编码交替为：条、空、条、空、条、空、条、空、条
            for (let j = 0; j < 9; j++) {
                const isBlack = j % 2 === 0
                const isWide = pattern[j] === '1'
                elements.push({
                    isBlack,
                    width: isWide ? wideWidth : narrowWidth
                })
            }

            // 字符间窄空隙（字符间隔）
            if (i < clean.length - 1) {
                elements.push({
                    isBlack: false,
                    width: narrowWidth
                })
            }
        }

        return elements
    }, [value, narrowWidth, wideWidth])

    const totalWidth = useMemo(() => {
        return bars.reduce((sum, b) => sum + b.width, 0)
    }, [bars])

    let currentX = 0

    return (
        <div className={`flex justify-center items-center select-none ${className}`}>
            <svg
                width={totalWidth}
                height={height}
                viewBox={`0 0 ${totalWidth} ${height}`}
                className="overflow-visible"
            >
                {bars.map((bar, idx) => {
                    const x = currentX
                    currentX += bar.width
                    if (!bar.isBlack) return null
                    return (
                        <rect
                            key={idx}
                            x={x}
                            y={0}
                            width={bar.width}
                            height={height}
                            fill="#18181b"
                        />
                    )
                })}
            </svg>
        </div>
    )
}
