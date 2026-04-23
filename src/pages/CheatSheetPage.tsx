import { useMemo, useState } from 'react'
import { ChevronRight, Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { CHEAT_SOFTWARES, DETAIL_PAGE_MAP, type SoftwareId } from './cheatsheets/registry'

export function CheatSheetPage(): React.ReactElement {
  const [query, setQuery] = useState('')
  const [activePage, setActivePage] = useState<SoftwareId | null>(null)

  const filteredSoftwares = useMemo(() => {
    if (!query.trim()) return CHEAT_SOFTWARES
    const q = query.toLowerCase()
    return CHEAT_SOFTWARES.filter(
      (software) =>
        software.name.toLowerCase().includes(q) ||
        software.description.toLowerCase().includes(q) ||
        software.sections.some((section) => section.title.toLowerCase().includes(q)),
    )
  }, [query])

  if (activePage) {
    const Page = DETAIL_PAGE_MAP[activePage]
    return <Page onBack={() => setActivePage(null)} />
  }

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden bg-zinc-50">
      <div className="shrink-0 border-b border-zinc-200 bg-white px-4 py-3">
        <div className="mb-2 flex items-end justify-between gap-3">
          <div>
            <h2 className="text-[14px] font-semibold text-zinc-800">速查表索引</h2>
            <p className="text-[12px] text-zinc-500">统一管理软件速查页，后续可持续扩展</p>
          </div>
          <span className="font-mono text-[11px] text-zinc-400">
            {filteredSoftwares.length} 个软件
          </span>
        </div>

        <div className="relative">
          <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
            <Search className="h-3.5 w-3.5 text-zinc-400" />
          </span>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索软件名称或分类..."
            className="h-8 border-zinc-200 bg-zinc-50 pl-8 text-[12px] focus:bg-white"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {filteredSoftwares.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-zinc-400">
            <Search className="mb-3 h-10 w-10 opacity-20" />
            <p className="text-[12px]">没有找到匹配的软件</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
            {filteredSoftwares.map((software) => {
              const sectionCount = software.sections.length
              const commandCount = software.sections.reduce((sum, section) => sum + section.items.length, 0)
              return (
                <button
                  key={software.id}
                  onClick={() => setActivePage(software.id)}
                  className="group rounded border border-zinc-200 bg-white p-3 text-left transition-all hover:-translate-y-[1px] hover:border-zinc-300 hover:shadow-sm"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={cn('inline-flex rounded p-1 text-white', software.color)}>
                        {software.icon}
                      </span>
                      <span className="text-[12px] font-semibold text-zinc-800">{software.name}</span>
                    </div>
                    <ChevronRight className="h-4 w-4 text-zinc-300 transition-colors group-hover:text-zinc-500" />
                  </div>
                  <p className="mb-2 line-clamp-2 min-h-9 text-[12px] text-zinc-500">{software.description}</p>
                  <div className="font-mono text-[11px] text-zinc-400">
                    {sectionCount} 组 · {commandCount} 条
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
