import { useCallback, useMemo, useState } from 'react'
import { ArrowLeft, Check, Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { CheatSection, CheatSoftware } from './types'

function SectionCard({
  section,
  headerColor,
  copiedKey,
  onCopy,
}: {
  section: CheatSection
  headerColor: string
  copiedKey: string | null
  onCopy: (command: string, key: string) => void
}) {
  return (
    <div className="break-inside-avoid mb-2 overflow-hidden rounded border border-zinc-200 shadow-sm">
      <div className={cn('px-2.5 py-1', headerColor)}>
        <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-white">
          {section.title}
        </span>
      </div>

      <div className="divide-y divide-zinc-100 bg-white">
        {section.items.map((item, idx) => {
          const key = `${section.title}::${idx}`
          const isCopied = copiedKey === key
          return (
            <button
              key={idx}
              onClick={() => onCopy(item.command, key)}
              title={`点击复制: ${item.command}`}
              className={cn(
                'group flex w-full items-center gap-0 text-left transition-colors',
                isCopied ? 'bg-green-50' : 'hover:bg-zinc-50',
              )}
            >
              <span
                className={cn(
                  'w-0.5 shrink-0 self-stretch transition-colors',
                  isCopied ? 'bg-green-400' : 'bg-transparent group-hover:bg-zinc-200',
                )}
              />

              <span className="flex w-full min-w-0 items-center gap-2 px-2.5 py-[4px]">
                <code className="w-[42%] shrink-0 truncate font-mono text-[11px] font-semibold text-blue-700">
                  {item.command}
                </code>
                <span className="flex-1 truncate text-[11px] text-zinc-500">{item.description}</span>
                <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                  {isCopied ? (
                    <Check className="h-3 w-3 text-green-500" />
                  ) : (
                    <span className="text-zinc-300 opacity-0 transition-opacity group-hover:opacity-100">
                      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <rect x="9" y="9" width="13" height="13" rx="2" />
                        <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                      </svg>
                    </span>
                  )}
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function CheatSheetDetailView({
  software,
  onBack,
}: {
  software: CheatSoftware
  onBack: () => void
}): React.ReactElement {
  const [query, setQuery] = useState('')
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [cols, setCols] = useState<2 | 3 | 4>(3)

  const filteredSections = useMemo(() => {
    if (!query.trim()) return software.sections
    const q = query.toLowerCase()
    return software.sections
      .map((section) => ({
        ...section,
        items: section.items.filter(
          (item) =>
            item.command.toLowerCase().includes(q) || item.description.toLowerCase().includes(q),
        ),
      }))
      .filter((section) => section.items.length > 0)
  }, [software.sections, query])

  const handleCopy = useCallback(async (command: string, key: string) => {
    try {
      await navigator.clipboard.writeText(command)
      setCopiedKey(key)
      setTimeout(() => setCopiedKey(null), 1200)
    } catch {
      // ignore
    }
  }, [])

  const colsClass = {
    2: 'columns-2',
    3: 'columns-3',
    4: 'columns-4',
  }[cols]

  const totalItems = filteredSections.reduce((n, s) => n + s.items.length, 0)

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden bg-zinc-50">
      <div className="shrink-0 border-b border-zinc-200 bg-white px-4 py-2.5">
        <div className="mb-2 flex items-center justify-between gap-2">
          <button
            onClick={onBack}
            className="inline-flex items-center gap-1.5 rounded border border-zinc-200 bg-white px-2 py-1 text-[12px] text-zinc-600 transition-colors hover:bg-zinc-50 hover:text-zinc-800"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            返回索引
          </button>
          <div className="inline-flex items-center gap-1.5 text-[12px] text-zinc-500">
            <span className={cn('inline-flex rounded px-2 py-[2px] text-white', software.color)}>
              {software.name}
            </span>
            <span className="text-zinc-400">{software.description}</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
              <Search className="h-3.5 w-3.5 text-zinc-400" />
            </span>
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`搜索 ${software.name} 命令或描述...`}
              className="h-7 border-zinc-200 bg-zinc-50 pl-8 text-[12px] focus:bg-white"
            />
          </div>

          <div className="flex shrink-0 items-center gap-0.5 rounded border border-zinc-200 bg-zinc-50 p-0.5">
            {([2, 3, 4] as const).map((n) => (
              <button
                key={n}
                onClick={() => setCols(n)}
                className={cn(
                  'h-5 w-6 rounded font-mono text-[10px] font-bold transition-colors',
                  cols === n ? 'bg-white text-zinc-800 shadow-sm' : 'text-zinc-400 hover:text-zinc-600',
                )}
              >
                {n}
              </button>
            ))}
          </div>

          <span className="shrink-0 font-mono text-[11px] text-zinc-400">
            {filteredSections.length} 组 · {totalItems} 条
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {filteredSections.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-zinc-400">
            <Search className="mb-3 h-10 w-10 opacity-20" />
            <p className="text-[12px]">没有找到匹配的命令</p>
          </div>
        ) : (
          <div className={cn(colsClass, 'gap-2.5')}>
            {filteredSections.map((section, i) => (
              <SectionCard
                key={section.title}
                section={section}
                headerColor={software.sectionColors[i % software.sectionColors.length]}
                copiedKey={copiedKey}
                onCopy={handleCopy}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
