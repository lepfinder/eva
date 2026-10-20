import { useEffect, useRef, useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import type { Board } from '@/services/whiteboard'

interface BoardListPanelProps {
  boards: Board[]
  activeId: string | null
  onOpen: (id: string) => void
  onCreate: () => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
}

export function BoardListPanel({
  boards,
  activeId,
  onOpen,
  onCreate,
  onRename,
  onDelete,
}: BoardListPanelProps): React.ReactElement {
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [pendingDelete, setPendingDelete] = useState<Board | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (renamingId) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [renamingId])

  const commitRename = () => {
    if (!renamingId) return
    const name = draft.trim()
    if (name) onRename(renamingId, name)
    setRenamingId(null)
  }

  return (
    <div className="flex h-full w-56 shrink-0 flex-col border-r bg-card">
      <div className="flex h-9 shrink-0 items-center justify-between px-3">
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/60">
          白板
        </span>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onCreate} title="新建白板">
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="flex-1 space-y-px overflow-y-auto px-1 pb-2 scrollbar-none">
        {boards.map((board) => {
          const active = board.id === activeId
          return (
            <div
              key={board.id}
              className={cn(
                'group flex h-8 cursor-default items-center gap-2 rounded px-2',
                active ? 'bg-muted' : 'hover:bg-muted/50',
              )}
              onClick={() => onOpen(board.id)}
              onDoubleClick={() => {
                setDraft(board.name)
                setRenamingId(board.id)
              }}
            >
              {renamingId === board.id ? (
                <input
                  ref={inputRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename()
                    if (e.key === 'Escape') setRenamingId(null)
                  }}
                  className="h-6 w-full rounded border bg-background px-1 text-sm outline-none"
                />
              ) : (
                <>
                  <span className="flex-1 truncate text-sm">{board.name}</span>
                  <span className="font-mono text-[10px] text-muted-foreground/60 group-hover:hidden">
                    {board.imageCount}
                  </span>
                  <button
                    type="button"
                    className="hidden shrink-0 text-muted-foreground hover:text-foreground group-hover:block"
                    title="重命名"
                    onClick={(e) => {
                      e.stopPropagation()
                      setDraft(board.name)
                      setRenamingId(board.id)
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    className="hidden shrink-0 text-muted-foreground hover:text-destructive group-hover:block"
                    title="删除白板"
                    onClick={(e) => {
                      e.stopPropagation()
                      setPendingDelete(board)
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </>
              )}
            </div>
          )
        })}
      </div>

      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>删除白板</AlertDialogTitle>
            <AlertDialogDescription>
              确定删除「{pendingDelete?.name}」？板上的 {pendingDelete?.imageCount} 张图片文件会一并从磁盘移除，无法恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (pendingDelete) onDelete(pendingDelete.id)
                setPendingDelete(null)
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
