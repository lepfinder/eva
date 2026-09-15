/**
 * EVA 工具目录：侧栏诊断工具 + 工具箱实用工具
 */
import {
  FileJson,
  Activity,
  ListFilter,
  GitBranch,
  Clock,
  Key,
  Database,
  Radio,
  SearchCode,
  Pipette,
  BookOpen,
} from 'lucide-react'

export type ToolId =
  | 'json-formatter'
  | 'memory-analyzer'
  | 'list-dedup'
  | 'set-ops'
  | 'timestamp'
  | 'password-generator'
  | 'sql-generator'
  | 'local-ports'
  | 'env-detector'
  | 'color-picker'
  | 'cheatsheet'

export type SidebarToolNav =
  | 'localports'
  | 'memory'
  | 'envdetector'

export interface ToolConfig {
  id: ToolId
  title: string
  description: string
  icon: React.ReactNode
  /** 若有值，从命令面板/快捷入口跳到侧栏页面，而不是工具箱 */
  nav?: SidebarToolNav
}

/** 侧栏 ACTION：诊断 / 环境类（从工具箱迁出） */
export const diagnosticTools: ToolConfig[] = [
  {
    id: 'local-ports',
    title: '本地监听端口',
    description: '查看和管理本地监听的网络端口',
    icon: <Radio className="h-8 w-8" />,
    nav: 'localports',
  },
  {
    id: 'memory-analyzer',
    title: '内存分析',
    description: '基于进程树聚合的智能内存分析工具，一键识别内存刺客',
    icon: <Activity className="h-8 w-8" />,
    nav: 'memory',
  },
  {
    id: 'env-detector',
    title: '环境探测',
    description: '自动识别本机开发环境，包括工具版本与路径',
    icon: <SearchCode className="h-8 w-8" />,
    nav: 'envdetector',
  },
]

/** 工具箱内保留的一次性实用工具 */
export const toolboxTools: ToolConfig[] = [
  {
    id: 'json-formatter',
    title: 'JSON 格式化',
    description: '格式化、压缩和验证 JSON 数据',
    icon: <FileJson className="h-8 w-8" />,
  },
  {
    id: 'list-dedup',
    title: '列表去重',
    description: '快速移除文本列表中的重复项，支持排序',
    icon: <ListFilter className="h-8 w-8" />,
  },
  {
    id: 'set-ops',
    title: '集合运算',
    description: '计算两个集合的交集、差集 (A-B, B-A)',
    icon: <GitBranch className="h-8 w-8" />,
  },
  {
    id: 'timestamp',
    title: '时间戳转换',
    description: '时间戳与格式化时间互转，支持秒/毫秒',
    icon: <Clock className="h-8 w-8" />,
  },
  {
    id: 'password-generator',
    title: '密码生成器',
    description: '生成安全复杂的随机密码',
    icon: <Key className="h-8 w-8" />,
  },
  {
    id: 'sql-generator',
    title: 'SQL 生成工具',
    description: '将列表数据转换为 SELECT/DELETE/UPDATE 语句',
    icon: <Database className="h-8 w-8" />,
  },
  {
    id: 'color-picker',
    title: '拾色器',
    description: '颜色选择与 Hex/RGB 代码转换工具',
    icon: <Pipette className="h-8 w-8" />,
  },
  {
    id: 'cheatsheet',
    title: '速查表',
    description: '常用软件命令与操作速查索引',
    icon: <BookOpen className="h-8 w-8" />,
  },
]

/** 快捷入口 / 使用统计用的完整列表 */
export const allTools: ToolConfig[] = [...diagnosticTools, ...toolboxTools]

export function resolveToolNav(toolId: string): SidebarToolNav | null {
  return diagnosticTools.find((t) => t.id === toolId)?.nav ?? null
}
