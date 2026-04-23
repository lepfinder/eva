/**
 * ModelSelector — 通用 AI 模型选择器
 *
 * 特性：
 *   - 支持 Ollama 本地模型 + 第三方 API 供应商模型分组展示
 *   - 受控组件（value / onValueChange）
 *   - 支持 size / className 等样式定制
 *   - 无数据时显示兜底占位选项
 */

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { useAIProviders } from '@/hooks/useAIProviders'
import { ModelInfo } from '@/hooks/usePythonService'

export interface ModelSelectorProps {
  /** 当前选中的模型值。Ollama: "model-name"  第三方: "providerId:model-name" */
  value: string
  /** 值变化时的回调 */
  onValueChange: (value: string) => void
  /** Ollama 本地模型列表（来自 usePythonService） */
  ollamaModels?: ModelInfo[]
  /** 是否禁用 */
  disabled?: boolean
  /** 触发器宽度样式，默认 w-40 */
  triggerClassName?: string
  /** 下拉列表 className */
  contentClassName?: string
  /** 字号，默认 text-[12px] */
  textSize?: string
  /** 触发器高度样式，默认 h-8 */
  triggerHeight?: string
  /** 是否只显示已连接的供应商，默认 true */
  onlyConnected?: boolean
  /** 占位文字 */
  placeholder?: string
}

export function ModelSelector({
  value,
  onValueChange,
  ollamaModels = [],
  disabled = false,
  triggerClassName,
  contentClassName,
  textSize = 'text-[12px]',
  triggerHeight = 'h-8',
  onlyConnected = true,
  placeholder = '选择模型'
}: ModelSelectorProps) {
  const { providers } = useAIProviders({ onlyConnected })

  const hasOllama = ollamaModels.length > 0
  const hasProviders = providers.length > 0
  const hasAnyModel = hasOllama || hasProviders

  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger
        className={cn(
          triggerHeight,
          textSize,
          'w-40',
          triggerClassName
        )}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>

      <SelectContent className={cn('max-h-80', textSize, contentClassName)}>
        {/* Ollama 本地模型分组 */}
        {hasOllama && (
          <>
            <div className="px-2 py-1.5 text-[11px] font-semibold text-muted-foreground tracking-wide uppercase">
              Ollama 本地
            </div>
            {ollamaModels.map((model) => (
              <SelectItem
                key={model.name}
                value={model.name}
                className={textSize}
              >
                {model.name}
              </SelectItem>
            ))}
          </>
        )}

        {/* 第三方供应商模型分组 */}
        {providers.map((provider) => (
          <div key={provider.id}>
            <div
              className={cn(
                'px-2 py-1.5 font-semibold text-muted-foreground leading-tight',
                'text-[11px] tracking-wide uppercase',
                hasOllama && 'border-t mt-1 pt-2'
              )}
            >
              {provider.name}
            </div>
            {provider.models.map((model) => (
              <SelectItem
                key={`${provider.id}:${model}`}
                value={`${provider.id}:${model}`}
                className={textSize}
              >
                {model}
              </SelectItem>
            ))}
          </div>
        ))}

        {/* 兜底：没有任何模型时 */}
        {!hasAnyModel && (
          <div className="px-2 py-3 text-center text-[11px] text-muted-foreground">
            暂无可用模型，请先启动 Ollama 或配置供应商 API Key
          </div>
        )}
      </SelectContent>
    </Select>
  )
}

/**
 * ModelSelectorLabel — 轻量标签版，仅用于表单场景（搭配 label 使用）
 * 相比 ModelSelector，宽度铺满父容器，适合竖向表单布局
 */
export function ModelSelectorFull(props: Omit<ModelSelectorProps, 'triggerClassName' | 'triggerHeight'>) {
  return (
    <ModelSelector
      {...props}
      triggerClassName="w-full h-11"
      triggerHeight="h-11"
      textSize="text-sm"
    />
  )
}
