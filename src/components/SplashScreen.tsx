import { motion, AnimatePresence } from 'framer-motion'
import { useEffect, useState } from 'react'
import logoImage from '@/assets/logo.png'

interface SplashScreenProps {
    onComplete: () => void
}

export function SplashScreen({ onComplete }: SplashScreenProps): React.ReactElement {
    const [phase, setPhase] = useState<'pulse' | 'expand' | 'done'>('pulse')

    useEffect(() => {
        // 阶段1: 核心跳动 (0.6s)
        const pulseTimer = setTimeout(() => {
            setPhase('expand')
        }, 600)

        // 阶段2: 向四周散开 (0.9s)
        const expandTimer = setTimeout(() => {
            setPhase('done')
            onComplete()
        }, 1500)

        return () => {
            clearTimeout(pulseTimer)
            clearTimeout(expandTimer)
        }
    }, [onComplete])

    return (
        <AnimatePresence>
            {phase !== 'done' && (
                <motion.div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950"
                    initial={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.3 }}
                >
                    {/* 背景网格线 */}
                    <div className="absolute inset-0 opacity-10">
                        <div
                            className="absolute inset-0"
                            style={{
                                backgroundImage: `
                  linear-gradient(to right, #a78bfa 1px, transparent 1px),
                  linear-gradient(to bottom, #a78bfa 1px, transparent 1px)
                `,
                                backgroundSize: '40px 40px'
                            }}
                        />
                    </div>

                    {/* 核心球体 */}
                    <motion.div
                        className="relative flex items-center justify-center"
                        initial={{ scale: 0.8, opacity: 0 }}
                        animate={
                            phase === 'pulse'
                                ? {
                                    scale: [0.8, 1.2, 1],
                                    opacity: 1
                                }
                                : {
                                    scale: 3,
                                    opacity: 0
                                }
                        }
                        transition={
                            phase === 'pulse'
                                ? {
                                    duration: 0.6,
                                    times: [0, 0.5, 1],
                                    ease: [0.34, 1.56, 0.64, 1]
                                }
                                : {
                                    duration: 0.9,
                                    ease: 'easeOut'
                                }
                        }
                    >
                        {/* 外层发光 */}
                        <motion.div
                            className="absolute inset-0 rounded-full"
                            style={{
                                background: 'radial-gradient(circle, rgba(167, 139, 250, 0.4) 0%, transparent 70%)',
                                width: '200px',
                                height: '200px',
                                filter: 'blur(30px)'
                            }}
                            animate={
                                phase === 'pulse'
                                    ? {
                                        scale: [1, 1.3, 1],
                                        opacity: [0.6, 1, 0.6]
                                    }
                                    : {}
                            }
                            transition={{
                                duration: 0.6,
                                repeat: phase === 'pulse' ? Infinity : 0,
                                repeatType: 'mirror'
                            }}
                        />

                        {/* 核心图标 */}
                        <motion.img
                            src={logoImage}
                            alt="EVA Core"
                            className="relative z-10 w-32 h-32 rounded-2xl"
                            style={{
                                filter: 'drop-shadow(0 0 20px rgba(167, 139, 250, 0.8))'
                            }}
                        />

                        {/* 内层光晕 */}
                        <motion.div
                            className="absolute inset-0 rounded-full"
                            style={{
                                background: 'radial-gradient(circle, rgba(79, 70, 229, 0.6) 0%, transparent 60%)',
                                width: '160px',
                                height: '160px',
                                filter: 'blur(20px)'
                            }}
                            animate={
                                phase === 'pulse'
                                    ? {
                                        scale: [1, 1.2, 1],
                                        opacity: [0.4, 0.8, 0.4]
                                    }
                                    : {}
                            }
                            transition={{
                                duration: 0.6,
                                repeat: phase === 'pulse' ? Infinity : 0,
                                repeatType: 'mirror'
                            }}
                        />
                    </motion.div>

                    {/* EVA 文字 */}
                    <motion.div
                        className="absolute bottom-1/3 font-mono font-semibold text-violet-400 tracking-[0.3em] text-2xl"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: phase === 'pulse' ? 1 : 0, y: phase === 'pulse' ? 0 : -20 }}
                        transition={{ delay: 0.3, duration: 0.3 }}
                    >
                        E V A
                    </motion.div>

                    {/* Slogan */}
                    <motion.div
                        className="absolute bottom-1/3 mt-12 font-mono text-zinc-400 tracking-wider text-xs"
                        style={{ marginTop: '3rem' }}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: phase === 'pulse' ? 0.6 : 0 }}
                        transition={{ delay: 0.5, duration: 0.3 }}
                    >
                        LOCAL INTELLIGENCE
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    )
}
