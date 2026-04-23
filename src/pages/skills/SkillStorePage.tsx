import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Loader2, Download, Check } from 'lucide-react'

interface SkillManifest {
    id: string
    name: string
    version: string
    description?: string
    author?: string
    repository?: string
}

interface SkillStorePageProps {
    onBack: () => void
}

export function SkillStorePage({ onBack }: SkillStorePageProps) {
    const [catalog, setCatalog] = useState<SkillManifest[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [installingId, setInstallingId] = useState<string | null>(null)
    const [installedSkills, setInstalledSkills] = useState<string[]>([])
    const [notification, setNotification] = useState<{ type: 'success' | 'error', message: string } | null>(null)

    useEffect(() => {
        loadCatalog()
        loadInstalledSkills()
    }, [])

    const loadCatalog = async () => {
        try {
            setIsLoading(true)
            const data = await window.api.skills.catalog()
            setCatalog(data)
        } catch (error) {
            console.error('Failed to load catalog:', error)
            setNotification({ type: 'error', message: 'Failed to load skill catalog' })
        } finally {
            setIsLoading(false)
        }
    }

    const loadInstalledSkills = async () => {
        try {
            const skills = await window.api.skills.list()
            setInstalledSkills(skills.map(s => s.id))
        } catch (error) {
            console.error('Failed to load installed skills:', error)
        }
    }

    const handleInstall = async (skill: SkillManifest) => {
        setInstallingId(skill.id)
        setNotification(null)
        try {
            // Pass empty string if no repository, installSkill will fallback to catalog copy
            const res = await window.api.skills.install(skill.repository || '', skill.id)
            if (res.success) {
                setNotification({ type: 'success', message: `Skill "${skill.name}" installed successfully` })
                loadInstalledSkills()
            } else {
                setNotification({ type: 'error', message: res.error || 'Installation failed' })
            }
        } catch (error: any) {
            setNotification({ type: 'error', message: error.message || 'Failed to install skill' })
        } finally {
            setInstallingId(null)
        }
    }

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-full">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        )
    }

    return (
        <div className="space-y-6 p-6">
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight">技能商店</h2>
                    <p className="text-muted-foreground">发现并安装自动化能力，让 EVA 进化。</p>
                </div>
                <Button variant="outline" onClick={onBack}>
                    返回我的技能
                </Button>
            </div>

            {notification && (
                <div className={`p-4 rounded-md ${notification.type === 'success' ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}`}>
                    {notification.message}
                </div>
            )}

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {catalog.map((skill) => {
                    const isInstalled = installedSkills.includes(skill.id)
                    const isInstalling = installingId === skill.id

                    return (
                        <Card key={skill.id} className="flex flex-col">
                            <CardHeader>
                                <div className="flex justify-between items-start">
                                    <CardTitle className="text-xl">{skill.name}</CardTitle>
                                    <Badge variant="outline">{skill.version}</Badge>
                                </div>
                                <CardDescription className="line-clamp-2">
                                    {skill.description || 'No description available'}
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="flex-1">
                                {skill.author && (
                                    <p className="text-sm text-muted-foreground">By {skill.author}</p>
                                )}
                            </CardContent>
                            <CardFooter>
                                {isInstalled ? (
                                    <Button variant="secondary" className="w-full cursor-default" disabled>
                                        <Check className="mr-2 h-4 w-4" />
                                        已就绪
                                    </Button>
                                ) : (
                                    <Button
                                        className="w-full"
                                        onClick={() => handleInstall(skill)}
                                        disabled={isInstalling}
                                    >
                                        {isInstalling ? (
                                            <>
                                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                安装中...
                                            </>
                                        ) : (
                                            <>
                                                <Download className="mr-2 h-4 w-4" />
                                                一键安装
                                            </>
                                        )}
                                    </Button>
                                )}
                            </CardFooter>
                        </Card>
                    )
                })}
            </div>
        </div>
    )
}
