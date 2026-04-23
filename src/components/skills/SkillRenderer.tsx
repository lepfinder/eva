import { useState, useEffect, useRef } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Terminal, Play, Loader2, AlertCircle } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'

export interface SkillUIInput {
    id: string
    type: 'input' | 'password' | 'number'
    label: string
    placeholder?: string
    defaultValue?: string
    required?: boolean
}

export interface SkillUIAction {
    id: string
    label: string
}

export interface SkillUI {
    title?: string
    description?: string
    inputs?: SkillUIInput[]
    components?: any[]
    actions?: SkillUIAction[]
}

interface SkillRendererProps {
    skillId: string
    ui: SkillUI
    onRun?: (input: any) => Promise<void>
}

export function SkillRenderer({ skillId, ui, onRun }: SkillRendererProps) {
    const [formData, setFormData] = useState<Record<string, string>>({})
    const [isRunning, setIsRunning] = useState(false)
    const [logs, setLogs] = useState<string[]>([])
    const [error, setError] = useState<string | null>(null)
    const logEndRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const initialData: Record<string, string> = {}
        const inputs = ui.inputs || ui.components || []
        inputs.forEach(input => {
            if ((input.type === 'input' || input.type === 'password' || input.type === 'number') && input.defaultValue) {
                initialData[input.id] = input.defaultValue
            }
        })
        setFormData(initialData)
    }, [ui])

    useEffect(() => {
        const removeLogListener = window.api.skills.onLog(skillId, (log) => {
            setLogs(prev => [...prev, log])
        })

        const removeExitListener = window.api.skills.onExit(skillId, (code) => {
            setIsRunning(false)
            setLogs(prev => [...prev, `\n[System] Process exited with code ${code}`])
        })

        return () => {
            removeLogListener()
            removeExitListener()
        }
    }, [skillId])

    useEffect(() => {
        logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [logs])

    const handleInputChange = (id: string, value: string) => {
        setFormData(prev => ({ ...prev, [id]: value }))
    }

    const handleRun = async () => {
        setIsRunning(true)
        setError(null)
        setLogs([])

        try {
            if (onRun) {
                await onRun(formData)
            } else {
                await window.api.skills.run(skillId, formData)
            }
        } catch (err: any) {
            console.error(err)
            setError(err.message || 'Failed to start skill')
            setIsRunning(false)
        }
    }

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle>{ui.title || skillId}</CardTitle>
                    {ui.description && <CardDescription>{ui.description}</CardDescription>}
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid gap-4">
                        {(ui.inputs || ui.components || []).filter(c => c.type === 'input' || c.type === 'password' || c.type === 'number').map(input => (
                            <div key={input.id} className="space-y-2">
                                <Label htmlFor={input.id}>
                                    {input.label}
                                    {input.required && <span className="text-red-500 ml-1">*</span>}
                                </Label>
                                <Input
                                    id={input.id}
                                    type={input.type === 'password' ? 'password' : 'text'}
                                    placeholder={input.placeholder}
                                    value={formData[input.id] || ''}
                                    onChange={(e) => handleInputChange(input.id, e.target.value)}
                                    disabled={isRunning}
                                />
                            </div>
                        ))}
                    </div>

                    <div className="pt-4">
                        <Button
                            onClick={handleRun}
                            disabled={isRunning}
                            className="w-full"
                        >
                            {isRunning ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Running...
                                </>
                            ) : (
                                <>
                                    <Play className="mr-2 h-4 w-4" />
                                    {ui.actions?.[0]?.label || 'Run Skill'}
                                </>
                            )}
                        </Button>
                    </div>

                    {error && (
                        <Alert variant="destructive">
                            <AlertCircle className="h-4 w-4" />
                            <AlertTitle>Error</AlertTitle>
                            <AlertDescription>{error}</AlertDescription>
                        </Alert>
                    )}
                </CardContent>
            </Card>

            <Card className="bg-zinc-950 text-zinc-50 border-zinc-800">
                <CardHeader className="pb-2 border-b border-zinc-800">
                    <div className="flex items-center gap-2">
                        <Terminal className="h-4 w-4 text-zinc-400" />
                        <CardTitle className="text-sm font-mono text-zinc-400">Output Log</CardTitle>
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    <ScrollArea className="h-64 rounded-b-lg">
                        <div className="p-4 font-mono text-xs space-y-1">
                            {logs.length === 0 ? (
                                <span className="text-zinc-600 italic">No output...</span>
                            ) : (
                                logs.map((log, i) => (
                                    <div key={i} className="whitespace-pre-wrap break-all">{log}</div>
                                ))
                            )}
                            <div ref={logEndRef} />
                        </div>
                    </ScrollArea>
                </CardContent>
            </Card>
        </div>
    )
}
