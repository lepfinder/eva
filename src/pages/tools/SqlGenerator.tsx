/**
 * SQL 生成工具
 * 将列表数据转换为 SELECT/DELETE/UPDATE 语句格式
 */
import { useState, useCallback } from 'react'
import { Copy, Check, Trash2, FileText, Database } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

// 示例数据
const SAMPLE_DATA = `10.20.249.1
10.20.249.100
10.20.249.101
10.20.249.15
10.20.249.16`

type SqlType = 'SELECT' | 'DELETE' | 'UPDATE'

export function SqlGenerator(): React.ReactElement {
    const [inputData, setInputData] = useState('')
    const [tableName, setTableName] = useState('table_name')
    const [columnName, setColumnName] = useState('column_name')
    const [updateSet, setUpdateSet] = useState('status = 1')
    const [sqlType, setSqlType] = useState<SqlType>('SELECT')
    const [output, setOutput] = useState('')
    const [copied, setCopied] = useState(false)
    const [copiedInClause, setCopiedInClause] = useState(false)

    // 生成 SQL
    const generateSql = useCallback(() => {
        const lines = inputData.split('\n')
            .map(line => line.trim())
            .filter(line => line !== '')

        if (lines.length === 0) {
            setOutput('')
            return
        }

        // 用单引号包装每个值，用逗号分隔
        const values = lines.map(v => `'${v}'`).join(',\n  ')
        
        let sql = ''
        if (sqlType === 'SELECT') {
            sql = `SELECT * FROM ${tableName} WHERE ${columnName} IN (\n  ${values}\n);`
        } else if (sqlType === 'DELETE') {
            sql = `DELETE FROM ${tableName} WHERE ${columnName} IN (\n  ${values}\n);`
        } else if (sqlType === 'UPDATE') {
            sql = `UPDATE ${tableName} SET ${updateSet} WHERE ${columnName} IN (\n  ${values}\n);`
        }
        
        setOutput(sql)
    }, [inputData, tableName, columnName, sqlType, updateSet])

    // 仅生成 IN 子句的值部分
    const getInClauseOnly = useCallback(() => {
        const lines = inputData.split('\n')
            .map(line => line.trim())
            .filter(line => line !== '')
        return lines.map(v => `'${v}'`).join(', ')
    }, [inputData])

    // 复制完整 SQL
    const copyToClipboard = async () => {
        if (!output) return
        try {
            await navigator.clipboard.writeText(output)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
        } catch (err) {
            console.error('复制失败:', err)
        }
    }

    // 仅复制 IN 子句
    const copyInClause = async () => {
        const inClause = getInClauseOnly()
        if (!inClause) return
        try {
            await navigator.clipboard.writeText(inClause)
            setCopiedInClause(true)
            setTimeout(() => setCopiedInClause(false), 2000)
        } catch (err) {
            console.error('复制失败:', err)
        }
    }

    // 加载示例
    const loadSample = () => {
        setInputData(SAMPLE_DATA)
        setTableName('hosts')
        setColumnName('ip_address')
    }

    // 清空
    const clearAll = () => {
        setInputData('')
        setOutput('')
        setTableName('table_name')
        setColumnName('column_name')
        setUpdateSet('status = 1')
    }

    // 统计
    const lineCount = inputData.split('\n').filter(l => l.trim()).length

    return (
        <TooltipProvider delayDuration={300}>
            <div className="h-full flex flex-col gap-4">
                {/* 配置区域 */}
                <div className="shrink-0 flex items-center justify-between gap-4 flex-wrap">
                    <div className="flex items-center gap-4">
                        <Tabs value={sqlType} onValueChange={(v) => setSqlType(v as SqlType)}>
                            <TabsList className="h-8">
                                <TabsTrigger value="SELECT" className="text-xs">SELECT</TabsTrigger>
                                <TabsTrigger value="DELETE" className="text-xs">DELETE</TabsTrigger>
                                <TabsTrigger value="UPDATE" className="text-xs">UPDATE</TabsTrigger>
                            </TabsList>
                        </Tabs>

                        <div className="flex items-center gap-2">
                            <Label htmlFor="tableName" className="text-sm border-l pl-4 whitespace-nowrap">表名</Label>
                            <Input
                                id="tableName"
                                value={tableName}
                                onChange={(e) => setTableName(e.target.value)}
                                className="w-40 h-8 font-mono text-sm"
                                placeholder="table_name"
                            />
                        </div>
                        <div className="flex items-center gap-2">
                            <Label htmlFor="columnName" className="text-sm whitespace-nowrap">字段名</Label>
                            <Input
                                id="columnName"
                                value={columnName}
                                onChange={(e) => setColumnName(e.target.value)}
                                className="w-40 h-8 font-mono text-sm"
                                placeholder="column_name"
                            />
                        </div>
                    </div>

                    {sqlType === 'UPDATE' && (
                        <div className="flex items-center gap-2">
                            <Label htmlFor="updateSet" className="text-sm whitespace-nowrap">SET 语句</Label>
                            <Input
                                id="updateSet"
                                value={updateSet}
                                onChange={(e) => setUpdateSet(e.target.value)}
                                className="w-60 h-8 font-mono text-sm"
                                placeholder="col = val"
                            />
                        </div>
                    )}
                </div>

                {/* 主内容区域 */}
                <div className="flex-1 min-h-0 grid grid-cols-2 gap-4">
                    {/* 输入区域 */}
                    <div className="flex flex-col border rounded-lg overflow-hidden bg-card">
                        <div className="shrink-0 flex items-center justify-between px-3 py-2 border-b bg-muted/30">
                            <span className="text-sm font-medium">输入数据</span>
                            <span className="text-xs text-muted-foreground">{lineCount} 个值</span>
                        </div>
                        <textarea
                            value={inputData}
                            onChange={(e) => setInputData(e.target.value)}
                            className="flex-1 p-3 bg-transparent font-mono text-sm resize-none border-0 outline-none focus:ring-0"
                            placeholder="每行输入一个值..."
                            spellCheck={false}
                        />
                    </div>

                    {/* 输出区域 */}
                    <div className="flex flex-col border rounded-lg overflow-hidden bg-card">
                        <div className="shrink-0 flex items-center justify-between px-3 py-2 border-b bg-muted/30">
                            <span className="text-sm font-medium">SQL 输出</span>
                            <div className="flex items-center gap-1">
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={copyInClause}
                                            disabled={!inputData.trim()}
                                            className="h-7 w-7"
                                        >
                                            {copiedInClause ? (
                                                <Check className="h-3.5 w-3.5 text-green-500" />
                                            ) : (
                                                <Database className="h-3.5 w-3.5" />
                                            )}
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>{copiedInClause ? '已复制' : '仅复制 IN 值'}</TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={copyToClipboard}
                                            disabled={!output}
                                            className="h-7 w-7"
                                        >
                                            {copied ? (
                                                <Check className="h-3.5 w-3.5 text-green-500" />
                                            ) : (
                                                <Copy className="h-3.5 w-3.5" />
                                            )}
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>{copied ? '已复制' : '复制完整 SQL'}</TooltipContent>
                                </Tooltip>
                            </div>
                        </div>
                        <pre className="flex-1 p-3 overflow-auto bg-transparent font-mono text-sm text-primary whitespace-pre-wrap">
                            {output || <span className="text-muted-foreground">点击"生成"按钮生成 SQL...</span>}
                        </pre>
                    </div>
                </div>

                {/* 操作按钮 */}
                <div className="shrink-0 flex items-center justify-center gap-3">
                    <Button onClick={generateSql} disabled={!inputData.trim()}>
                        <Database className="h-4 w-4 mr-2" />
                        生成 SQL
                    </Button>
                    <Button variant="outline" onClick={loadSample}>
                        <FileText className="h-4 w-4 mr-2" />
                        加载示例
                    </Button>
                    <Button variant="outline" onClick={clearAll}>
                        <Trash2 className="h-4 w-4 mr-2" />
                        清空
                    </Button>
                </div>
            </div>
        </TooltipProvider>
    )
}
