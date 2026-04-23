import { useState } from 'react'
import { SkillHostPage } from './SkillHostPage'
import { SkillStorePage } from './SkillStorePage'

export function SkillCenterPage() {
    const [view, setView] = useState<'installed' | 'store'>('installed')

    return (
        <div className="h-full w-full">
            {view === 'installed' ? (
                <SkillHostPage onOpenStore={() => setView('store')} />
            ) : (
                <SkillStorePage onBack={() => setView('installed')} />
            )}
        </div>
    )
}
