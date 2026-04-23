import React from 'react'

interface EVANucleusIconProps {
    size?: number
    className?: string
}

export const EVANucleusIcon: React.FC<EVANucleusIconProps> = ({
    size = 40,
    className = ''
}) => {
    return (
        <div
            className={`relative inline-flex items-center justify-center ${className}`}
            style={{ width: size, height: size }}
        >
            <svg
                viewBox="0 0 100 100"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className="w-full h-full"
            >
                {/* 三段互锁的弧线，模仿 logo.png 的设计 */}

                {/* 1. Cyan/Teal 弧线 (右上到右下) */}
                <path
                    d="M 65 20 A 30 30 0 0 1 80 50 A 30 30 0 0 1 65 80"
                    stroke="#2DD4BF"
                    strokeWidth="12"
                    strokeLinecap="round"
                    fill="none"
                />

                {/* 2. Violet/Purple 弧线 (右下到左下) */}
                <path
                    d="M 65 80 A 30 30 0 0 1 35 80 A 30 30 0 0 1 20 50"
                    stroke="#8B5CF6"
                    strokeWidth="12"
                    strokeLinecap="round"
                    fill="none"
                />

                {/* 3. Green 弧线 (左下到右上，带虚线效果) */}
                <path
                    d="M 20 50 A 30 30 0 0 1 35 20 A 30 30 0 0 1 65 20"
                    stroke="#10B981"
                    strokeWidth="12"
                    strokeLinecap="round"
                    strokeDasharray="8 4"
                    fill="none"
                />

                {/* 中心白点 - AI 意识焦点 */}
                <circle cx="50" cy="50" r="6" fill="white" />
            </svg>
        </div>
    )
}

export default EVANucleusIcon
