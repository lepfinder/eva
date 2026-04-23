/**
 * useAIProviders — 统一加载所有 AI 供应商及其模型列表
 *
 * 数据来源：
 *   - 第三方 API 供应商：通过 IPC window.api.aiProviderGetAll() 获取
 *   - Ollama 本地模型：通过 usePythonService 的 models 状态获取（由调用方传入）
 *
 * 职责边界：
 *   - 仅负责数据加载与格式化，不做 UI 渲染
 *   - 调用方可传入 ollamaModels 以合并本地模型
 */

import { useState, useEffect } from 'react'
import { AIProviderInfo, getProviderBaseUrl } from '../lib/chat-utils'
import { ModelInfo } from './usePythonService'

// 硬编码的已知供应商元数据（展示名称 & 默认模型列表）
export const KNOWN_PROVIDERS: Record<string, { name: string; defaultModels: string[] }> = {
  deepseek: {
    name: 'DeepSeek',
    defaultModels: ['deepseek-chat', 'deepseek-coder', 'deepseek-reasoner']
  },
  qwen: {
    name: '通义千问',
    defaultModels: ['qwen-turbo', 'qwen-plus', 'qwen-max', 'qwen-long']
  },
  openai: {
    name: 'OpenAI',
    defaultModels: ['gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo']
  },
  anthropic: {
    name: 'Claude',
    defaultModels: ['claude-3-5-sonnet', 'claude-3-opus', 'claude-3-haiku']
  },
  moonshot: {
    name: 'Kimi',
    defaultModels: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k']
  },
  zhipu: {
    name: '智谱 AI',
    defaultModels: ['glm-4', 'glm-4-plus', 'glm-4-air', 'glm-4-flash']
  },
  google: {
    name: 'Google Gemini',
    defaultModels: ['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.0-flash-exp']
  },
  nvidia: {
    name: 'NVIDIA',
    defaultModels: ['minimaxai/minimax-m2.7']
  }
}

export interface UseAIProvidersOptions {
  /** 传入来自 usePythonService 的 Ollama 本地模型列表 */
  ollamaModels?: ModelInfo[]
  /** 是否只显示已配置 API Key 的供应商，默认 true */
  onlyConnected?: boolean
}

export interface UseAIProvidersReturn {
  /** 第三方 API 供应商列表 */
  providers: AIProviderInfo[]
  /** 是否正在加载供应商配置 */
  isLoading: boolean
  /** 重新加载供应商配置 */
  reload: () => Promise<void>
  /**
   * 解析复合模型值为 { providerId, model, baseUrl, apiKey } 结构
   * Ollama 模型值格式: "model-name"
   * 第三方模型值格式: "providerId:model-name"
   */
  parseModelValue: (value: string) => ParsedModelValue
}

export interface ParsedModelValue {
  /** 原始 value，原样传给后端 model 字段时，需用 actualModel */
  raw: string
  /** 实际发送给 LLM 的模型名（不含 providerId 前缀） */
  actualModel: string
  /** 供应商 ID，Ollama 时为 'ollama' */
  providerId: string
  /** API Base URL */
  baseUrl?: string
  /** API Key */
  apiKey?: string
  /** 是否为 Ollama 本地模型 */
  isOllama: boolean
}

export function useAIProviders(options: UseAIProvidersOptions = {}): UseAIProvidersReturn {
  const { ollamaModels = [], onlyConnected = true } = options

  const [providers, setProviders] = useState<AIProviderInfo[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const load = async () => {
    setIsLoading(true)
    try {
      const configs = await window.api.aiProviderGetAll()
      const providerInfos: AIProviderInfo[] = []

      if (configs && configs.length > 0) {
        configs.forEach((config: any) => {
          const known = KNOWN_PROVIDERS[config.id]
          providerInfos.push({
            id: config.id,
            name: known
              ? known.name
              : config.id.charAt(0).toUpperCase() + config.id.slice(1),
            models:
              config.models && config.models.length > 0
                ? config.models
                : known
                  ? known.defaultModels
                  : [],
            status: config.status || 'disconnected',
            apiKey: config.apiKey,
            baseUrl: config.baseUrl
          })
        })
      }

      // 补全未配置的已知供应商（以 disconnected 状态呈现）
      Object.entries(KNOWN_PROVIDERS).forEach(([id, meta]) => {
        if (!providerInfos.find((p) => p.id === id)) {
          providerInfos.push({
            id,
            name: meta.name,
            models: meta.defaultModels,
            status: 'disconnected'
          })
        }
      })

      setProviders(providerInfos)
    } catch (err) {
      console.error('[useAIProviders] Failed to load providers:', err)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  // 解析复合 value
  const parseModelValue = (value: string): ParsedModelValue => {
    // 检查是否是 "providerId:model" 格式
    const providerMatch = providers.find((p) => value.startsWith(`${p.id}:`))

    if (providerMatch) {
      const actualModel = value.replace(`${providerMatch.id}:`, '')
      return {
        raw: value,
        actualModel,
        providerId: providerMatch.id,
        baseUrl: providerMatch.baseUrl || getProviderBaseUrl(providerMatch.id),
        apiKey: providerMatch.apiKey,
        isOllama: false
      }
    }

    // Ollama 模型
    return {
      raw: value,
      actualModel: value,
      providerId: 'ollama',
      isOllama: true
    }
  }

  // 根据 onlyConnected 过滤
  const filteredProviders = onlyConnected
    ? providers.filter((p) => p.status === 'connected' && p.apiKey)
    : providers

  // 注意：ollamaModels 不放入 providers，由 ModelSelector 组件单独处理
  void ollamaModels

  return {
    providers: filteredProviders,
    isLoading,
    reload: load,
    parseModelValue
  }
}
