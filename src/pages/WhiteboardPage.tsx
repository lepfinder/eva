import { X } from 'lucide-react'
import { BoardCanvas } from '@/components/whiteboard/BoardCanvas'
import { BoardListPanel } from '@/components/whiteboard/BoardListPanel'
import { useBoardStore } from '@/components/whiteboard/useBoardStore'

export function WhiteboardPage(): React.ReactElement {
  const store = useBoardStore()

  return (
    <div className="-m-6 flex h-[calc(100%+3rem)] w-[calc(100%+3rem)] overflow-hidden">
      <BoardListPanel
        boards={store.boards}
        activeId={store.activeId}
        onOpen={(id) => {
          if (id !== store.activeId) void store.openBoard(id)
        }}
        onCreate={() => void store.createBoard()}
        onRename={(id, name) => void store.renameBoard(id, name)}
        onDelete={(id) => void store.deleteBoard(id)}
      />

      <div className="relative min-w-0 flex-1">
        {store.activeId ? (
          <BoardCanvas store={store} />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
            {store.loading ? '载入中…' : '没有白板'}
          </div>
        )}

        {store.error && (
          <div className="absolute inset-x-0 bottom-4 flex justify-center px-4">
            <div className="flex max-w-lg items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <span className="flex-1 break-all">{store.error}</span>
              <button type="button" onClick={() => store.setError(null)} className="shrink-0">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
