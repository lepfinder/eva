import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Loader2, Play, AlertCircle, Terminal } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

export function BastionLoginTool() {
    const [username, setUsername] = useState('')
    const [password, setPassword] = useState('')
    const [targetDb, setTargetDb] = useState('DB-securio-rw')
    const [isRunning, setIsRunning] = useState(false)
    const [logs, setLogs] = useState<string[]>([])
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        window.api.getBastionConfig().then(config => {
            if (config.username) setUsername(config.username)
            if (config.password) setPassword(config.password)
        })
    }, [])

    const addLog = (msg: string) => {
        setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`])
    }

    const handleRun = async () => {
        if (!username || !password) {
            setError('请输入用户名和密码')
            return
        }

        setIsRunning(true)
        setError(null)
        setLogs([])
        addLog('开始执行自动化脚本...')

        try {
            const res = await window.api.runBastionLogin({ username, password, targetDb })

            if (res.success && res.connection_string) {
                addLog('✅ 获取连接串成功！')
                addLog(res.connection_string)
                // 可以选择在这里也设置一个成功状态的 UI 显示
                setError(null) // 清除错误
            } else {
                addLog('脚本执行完成')
            }

        } catch (err: any) {
            console.error(err)
            setError(err.message || '执行失败')
            addLog(`执行失败: ${err.message}`)
        } finally {
            setIsRunning(false)
        }
    }

    return (
        <div className="max-w-3xl mx-auto space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle>堡垒机连接串获取</CardTitle>
                    <CardDescription>
                        使用 Playwright 自动登录 https://bastion-db.5i5j.com/core/auth/login/?next=/luna/
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>用户名</Label>
                            <Input
                                value={username}
                                onChange={e => setUsername(e.target.value)}
                                placeholder="请输入用户名"
                                disabled={isRunning}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>密码</Label>
                            <Input
                                type="password"
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                placeholder="请输入密码"
                                disabled={isRunning}
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label>目标数据库</Label>
                        <Select value={targetDb} onValueChange={setTargetDb} disabled={isRunning}>
                            <SelectTrigger>
                                <SelectValue placeholder="选择数据库" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="DB-securio-rw">DB-securio-rw</SelectItem>
                                <SelectItem value="DB-radius-200.243">DB-radius-200.243</SelectItem>
                                <SelectItem value="DB-radius-rw-200.243">DB-radius-rw-200.243</SelectItem>
                                <SelectItem value="DB-smartform-rw">DB-smartform-rw</SelectItem>
                                <SelectItem value="DB-xflow-rw">DB-xflow-rw</SelectItem>
                                <SelectItem value="DB-运维共用">DB-运维共用</SelectItem>
                                <SelectItem value="DB-运维共用-rw">DB-运维共用-rw</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <Button
                        onClick={handleRun}
                        disabled={isRunning || !username || !password}
                        className="w-full"
                    >
                        {isRunning ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                正在执行...
                            </>
                        ) : (
                            <>
                                <Play className="mr-2 h-4 w-4" />
                                开始运行
                            </>
                        )}
                    </Button>

                    {error && (
                        <Alert variant="destructive">
                            <AlertCircle className="h-4 w-4" />
                            <AlertTitle>错误</AlertTitle>
                            <AlertDescription>{error}</AlertDescription>
                        </Alert>
                    )}

                    {logs.some(l => l.includes('✅ 获取连接串成功')) && (
                        <Alert className="bg-green-500/10 text-green-500 border-green-500/50">
                            <Terminal className="h-4 w-4" />
                            <AlertTitle>连接串已复制</AlertTitle>
                            <AlertDescription className="mt-2 font-mono text-xs break-all bg-black/20 p-2 rounded">
                                {logs.find(l => l.includes('mysql'))?.split('] ')[1] || '内容在剪贴板中'}
                            </AlertDescription>
                        </Alert>
                    )}
                </CardContent>
            </Card>

            <Card className="bg-zinc-950 text-zinc-50 border-zinc-800">
                <CardHeader className="pb-2 border-b border-zinc-800">
                    <div className="flex items-center gap-2">
                        <Terminal className="h-4 w-4 text-zinc-400" />
                        <CardTitle className="text-sm font-mono text-zinc-400">执行日志</CardTitle>
                    </div>
                </CardHeader>
                <CardContent className="p-4 font-mono text-xs space-y-1 h-64 overflow-y-auto">
                    {logs.length === 0 ? (
                        <span className="text-zinc-600 italic">暂无日志...</span>
                    ) : (
                        logs.map((log, i) => (
                            <div key={i} className="break-all">{log}</div>
                        ))
                    )}
                </CardContent>
            </Card>
        </div>
    )
}
