import { SourceInfo } from '../hooks/useChatSessions'

// 供应商配置接口
export interface ProviderConfig {
    type: 'ollama' | 'openai'
    apiBase?: string
    apiKey?: string
    defaultModel?: string
}

// AI 供应商信息（用于模型选择）
export interface AIProviderInfo {
    id: string
    name: string
    models: string[]
    baseUrl?: string
    apiKey?: string
    status: 'connected' | 'disconnected' | 'error'
}

// 默认配置
export const DEFAULT_PROVIDER_CONFIG: ProviderConfig = {
    type: 'ollama',
    defaultModel: 'qwen3-coder:30b'
}

// 获取供应商默认 API 基础 URL
export function getProviderBaseUrl(providerId: string): string {
    const baseUrls: Record<string, string> = {
        deepseek: 'https://api.deepseek.com/v1',
        zhipu: 'https://open.bigmodel.cn/api/coding/paas/v4',
        qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        openai: 'https://api.openai.com/v1',
        anthropic: 'https://api.anthropic.com',
        moonshot: 'https://api.moonshot.cn/v1',
        google: 'https://generativelanguage.googleapis.com/v1beta/openai',
        nvidia: 'https://integrate.api.nvidia.com/v1'
    }
    return baseUrls[providerId] || 'https://api.openai.com/v1'
}

// 从 localStorage 加载配置
export function loadProviderConfig(): ProviderConfig {
    try {
        const saved = localStorage.getItem('mygpt-provider-config')
        if (saved) {
            return JSON.parse(saved)
        }
    } catch (e) {
        console.error('Failed to load provider config:', e)
    }
    return DEFAULT_PROVIDER_CONFIG
}

// 保存配置到 localStorage
export function saveProviderConfig(config: ProviderConfig): void {
    localStorage.setItem('mygpt-provider-config', JSON.stringify(config))
}

export interface ThinkingContent {
    thinking: string
    content: string
}

/**
 * 解析思维链内容
 */
export function parseThinkingContent(text: string): ThinkingContent {
    const thinkMatch = text.match(/<think>([\s\S]*?)<\/think>/i)
    if (thinkMatch) {
        const thinking = thinkMatch[1].trim()
        const content = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
        return { thinking, content }
    }
    const openThinkMatch = text.match(/<think>([\s\S]*)$/i)
    if (openThinkMatch) {
        return { thinking: openThinkMatch[1], content: '' }
    }
    return { thinking: '', content: text }
}

/**
 * 从内容中提取脚注格式的来源链接
 * 只提取 "参考来源：" 之后的内容
 */
export function extractSources(content: string): SourceInfo[] {
    const sources: SourceInfo[] = []

    // 查找 "参考来源" 部分
    const sourcesSectionMatch = content.match(/参考来源[：:]\s*([\s\S]*?)$/i)

    if (sourcesSectionMatch) {
        const sourcesSection = sourcesSectionMatch[1]

        // 在来源部分中匹配脚注格式：[1] 文件路径或 `路径`
        // 修改正则以支持直到行尾或下一个 [ 之前的任意内容（含空格、问号等）
        const footnoteRegex = /\[(\d+)\]\s*([^\n\r\[]+)/g
        let match

        while ((match = footnoteRegex.exec(sourcesSection)) !== null) {
            const index = parseInt(match[1], 10)

            // 提取捕获的内容并清理
            let fileName = match[2].trim()

            // 1. 如果有反引号包裹，移除反引号
            fileName = fileName.replace(/^`|`$/g, '')

            // 2. 特别重要：不再自动移除末尾的问号等，因为那是文件名的一部分
            // 只移除可能的行尾空白
            fileName = fileName.trim()

            if (fileName && !sources.some(s => s.index === index)) {
                sources.push({ index, fileName })
            }
        }
    }

    // 兼容旧格式：【来源: xxx】（可能出现在任何位置）
    const bracketRegex = /【来源:\s*([^】]+)】/g
    let match
    let idx = sources.length + 1
    while ((match = bracketRegex.exec(content)) !== null) {
        const fileName = match[1].trim()
        if (fileName && !sources.some(s => s.fileName === fileName)) {
            sources.push({ index: idx++, fileName })
        }
    }

    // 按索引排序
    sources.sort((a, b) => a.index - b.index)

    return sources
}
