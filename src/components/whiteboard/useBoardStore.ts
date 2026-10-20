import { useCallback, useEffect, useRef, useState } from 'react'
import {
  MAX_SCALE,
  MIN_SCALE,
  whiteboardApi,
  type Board,
  type BoardElement,
  type BoardImage,
  type ImageTransform,
  type TextTransform,
} from '@/services/whiteboard'

const SAVE_DEBOUNCE_MS = 400

export interface Viewport {
  x: number
  y: number
  scale: number
}

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
}

function toImageTransform(el: BoardImage): ImageTransform {
  return {
    id: el.id,
    x: el.x,
    y: el.y,
    w: el.w,
    h: el.h,
    zIndex: el.zIndex,
    cropX: el.cropX,
    cropY: el.cropY,
    cropW: el.cropW,
    cropH: el.cropH,
  }
}

function toTextTransform(el: Extract<BoardElement, { kind: 'text' }>): TextTransform {
  return {
    id: el.id,
    text: el.text,
    color: el.color,
    fontSize: el.fontSize,
    x: el.x,
    y: el.y,
    w: el.w,
    h: el.h,
    zIndex: el.zIndex,
  }
}

/**
 * 白板数据与持久化。图片与文字统一成 element 供画布交互，
 * 落盘时按类型拆回两张表；视口与几何都走防抖回写。
 */
export function useBoardStore() {
  const [boards, setBoards] = useState<Board[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [elements, setElements] = useState<BoardElement[]>([])
  const [viewport, setViewportState] = useState<Viewport>({ x: 0, y: 0, scale: 1 })
  const [selection, setSelection] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const elementsRef = useRef<BoardElement[]>([])
  const viewportRef = useRef<Viewport>(viewport)
  const activeIdRef = useRef<string | null>(null)
  const viewportTimer = useRef<number | null>(null)
  const elementsTimer = useRef<number | null>(null)
  const bootstrapped = useRef(false)

  const persistElements = useCallback((boardId: string, next: BoardElement[]) => {
    const images = next.filter((e): e is Extract<BoardElement, { kind: 'image' }> => e.kind === 'image')
    const texts = next.filter((e): e is Extract<BoardElement, { kind: 'text' }> => e.kind === 'text')
    void whiteboardApi
      .updateImagesBatch(boardId, images.map(toImageTransform))
      .catch((e) => setError(String(e)))
    void whiteboardApi
      .updateTextsBatch(boardId, texts.map(toTextTransform))
      .catch((e) => setError(String(e)))
  }, [])

  const scheduleElementsSave = useCallback(
    (boardId: string, next: BoardElement[]) => {
      if (elementsTimer.current) window.clearTimeout(elementsTimer.current)
      elementsTimer.current = window.setTimeout(() => {
        elementsTimer.current = null
        persistElements(boardId, next)
      }, SAVE_DEBOUNCE_MS)
    },
    [persistElements],
  )

  const scheduleViewportSave = useCallback((boardId: string, vp: Viewport) => {
    if (viewportTimer.current) window.clearTimeout(viewportTimer.current)
    viewportTimer.current = window.setTimeout(() => {
      viewportTimer.current = null
      void whiteboardApi
        .saveViewport(boardId, vp.x, vp.y, vp.scale)
        .catch((e) => setError(String(e)))
    }, SAVE_DEBOUNCE_MS)
  }, [])

  /** 立即落盘，用于切板/卸载前防止防抖窗口内的改动丢失 */
  const flushNow = useCallback(() => {
    const boardId = activeIdRef.current
    if (!boardId) return
    if (viewportTimer.current) {
      window.clearTimeout(viewportTimer.current)
      viewportTimer.current = null
      const vp = viewportRef.current
      void whiteboardApi.saveViewport(boardId, vp.x, vp.y, vp.scale).catch(() => {})
    }
    if (elementsTimer.current) {
      window.clearTimeout(elementsTimer.current)
      elementsTimer.current = null
      persistElements(boardId, elementsRef.current)
    }
  }, [persistElements])

  const setViewport = useCallback(
    (vp: Viewport) => {
      const next: Viewport = { x: vp.x, y: vp.y, scale: clampScale(vp.scale) }
      viewportRef.current = next
      setViewportState(next)
      const boardId = activeIdRef.current
      if (boardId) scheduleViewportSave(boardId, next)
    },
    [scheduleViewportSave],
  )

  const applyElements = useCallback(
    (next: BoardElement[]) => {
      elementsRef.current = next
      setElements(next)
      const boardId = activeIdRef.current
      if (boardId) scheduleElementsSave(boardId, next)
    },
    [scheduleElementsSave],
  )

  const loadBoards = useCallback(async () => {
    try {
      const list = await whiteboardApi.listBoards()
      setBoards(list)
      return list
    } catch (e) {
      setError(String(e))
      return []
    }
  }, [])

  const openBoard = useCallback(
    async (id: string) => {
      flushNow()
      setLoading(true)
      try {
        const detail = await whiteboardApi.getBoard(id)
        activeIdRef.current = id
        setActiveId(id)
        const next: BoardElement[] = [
          ...detail.images.map((i) => ({ kind: 'image' as const, ...i })),
          ...detail.texts.map((t) => ({ kind: 'text' as const, ...t })),
        ]
        elementsRef.current = next
        setElements(next)
        setSelection([])
        setBoards((prev) => prev.map((b) => (b.id === id ? detail.board : b)))
        viewportRef.current = {
          x: detail.board.viewportX,
          y: detail.board.viewportY,
          scale: clampScale(detail.board.viewportScale),
        }
        setViewportState(viewportRef.current)
      } catch (e) {
        setError(String(e))
      } finally {
        setLoading(false)
      }
    },
    [flushNow],
  )

  const createBoard = useCallback(async (): Promise<string | null> => {
    try {
      const board = await whiteboardApi.createBoard()
      setBoards((prev) => [...prev, board])
      await openBoard(board.id)
      return board.id
    } catch (e) {
      setError(String(e))
      return null
    }
  }, [openBoard])

  const renameBoard = useCallback(async (id: string, name: string) => {
    try {
      const updated = await whiteboardApi.renameBoard(id, name)
      setBoards((prev) => prev.map((b) => (b.id === id ? updated : b)))
    } catch (e) {
      setError(String(e))
    }
  }, [])

  const deleteBoard = useCallback(
    async (id: string) => {
      try {
        await whiteboardApi.deleteBoard(id)
        if (activeIdRef.current === id) {
          if (viewportTimer.current) window.clearTimeout(viewportTimer.current)
          if (elementsTimer.current) window.clearTimeout(elementsTimer.current)
          viewportTimer.current = null
          elementsTimer.current = null
          activeIdRef.current = null
          setActiveId(null)
          elementsRef.current = []
          setElements([])
          setSelection([])
        }
        const rest = await whiteboardApi.listBoards()
        setBoards(rest)
        if (!activeIdRef.current) {
          if (rest.length > 0) {
            await openBoard(rest[0].id)
          } else {
            // 删掉最后一块板时直接补一块，避免留下无出口的空态
            await createBoard()
          }
        }
      } catch (e) {
        setError(String(e))
      }
    },
    [openBoard, createBoard],
  )

  const refreshBoards = useCallback(async () => {
    const list = await whiteboardApi.listBoards()
    setBoards(list)
  }, [])

  /** 粘贴/拖入的位图 → base64 交给 Rust 落盘 */
  const addImageFiles = useCallback(
    async (files: File[], center: { x: number; y: number }): Promise<BoardElement[]> => {
      const boardId = activeIdRef.current
      if (!boardId || files.length === 0) return []
      const added: BoardElement[] = []
      try {
        for (let i = 0; i < files.length; i++) {
          const buf = new Uint8Array(await files[i].arrayBuffer())
          let binary = ''
          const chunk = 0x8000
          for (let off = 0; off < buf.length; off += chunk) {
            binary += String.fromCharCode(...buf.subarray(off, off + chunk))
          }
          const created = await whiteboardApi.addImageFromBytes(
            boardId,
            btoa(binary),
            center.x + i * 24,
            center.y + i * 24,
          )
          added.push({ kind: 'image', ...created })
        }
      } catch (e) {
        setError(String(e))
      }
      if (added.length > 0) {
        const next = [...elementsRef.current, ...added]
        elementsRef.current = next
        setElements(next)
        setBoards((prev) =>
          prev.map((b) =>
            b.id === boardId
              ? {
                  ...b,
                  imageCount: next.filter((e) => e.kind === 'image').length,
                  coverPath:
                    (added[0] as Extract<BoardElement, { kind: 'image' }>).thumbPath ?? b.coverPath,
                }
              : b,
          ),
        )
        scheduleElementsSave(boardId, next)
      }
      return added
    },
    [scheduleElementsSave],
  )

  const addImagePaths = useCallback(
    async (paths: string[], center: { x: number; y: number }): Promise<BoardElement[]> => {
      const boardId = activeIdRef.current
      if (!boardId || paths.length === 0) return []
      const added: BoardElement[] = []
      try {
        for (let i = 0; i < paths.length; i++) {
          const created = await whiteboardApi.addImageFromPath(
            boardId,
            paths[i],
            center.x + i * 24,
            center.y + i * 24,
          )
          added.push({ kind: 'image', ...created })
        }
      } catch (e) {
        setError(String(e))
      }
      if (added.length > 0) {
        const next = [...elementsRef.current, ...added]
        elementsRef.current = next
        setElements(next)
        setBoards((prev) =>
          prev.map((b) =>
            b.id === boardId
              ? { ...b, imageCount: next.filter((e) => e.kind === 'image').length }
              : b,
          ),
        )
        scheduleElementsSave(boardId, next)
      }
      return added
    },
    [scheduleElementsSave],
  )

  const addText = useCallback(
    async (text: string, x: number, y: number): Promise<BoardElement | null> => {
      const boardId = activeIdRef.current
      if (!boardId) return null
      try {
        const created = await whiteboardApi.addText(boardId, text, x, y, 24, 'auto')
        const el: BoardElement = { kind: 'text', ...created }
        const next = [...elementsRef.current, el]
        elementsRef.current = next
        setElements(next)
        scheduleElementsSave(boardId, next)
        return el
      } catch (e) {
        setError(String(e))
        return null
      }
    },
    [scheduleElementsSave],
  )

  const removeElements = useCallback(
    async (ids: string[]) => {
      const boardId = activeIdRef.current
      if (!boardId || ids.length === 0) return
      const idSet = new Set(ids)
      const removed = elementsRef.current.filter((i) => idSet.has(i.id))
      const next = elementsRef.current.filter((i) => !idSet.has(i.id))
      elementsRef.current = next
      setElements(next)
      setSelection((prev) => prev.filter((id) => !idSet.has(id)))
      setBoards((prev) =>
        prev.map((b) =>
          b.id === boardId
            ? { ...b, imageCount: next.filter((e) => e.kind === 'image').length }
            : b,
        ),
      )
      const imageIds = removed.filter((r) => r.kind === 'image').map((r) => r.id)
      const textIds = removed.filter((r) => r.kind === 'text').map((r) => r.id)
      try {
        if (imageIds.length > 0) await whiteboardApi.deleteImages(boardId, imageIds)
        if (textIds.length > 0) await whiteboardApi.deleteTexts(boardId, textIds)
        // 图片文件已从磁盘移除，重取列表以刷新可能失效的封面缩略图
        if (imageIds.length > 0) await refreshBoards()
      } catch (e) {
        setError(String(e))
      }
    },
    [refreshBoards],
  )

  // 首屏：载入白板列表并打开最近一块。
  // StrictMode 会双跑 effect，用 ref 拦住，否则会凭空建出第二块板。
  useEffect(() => {
    if (bootstrapped.current) return
    bootstrapped.current = true
    void (async () => {
      const list = await loadBoards()
      if (list.length > 0) await openBoard(list[0].id)
      else await createBoard()
    })()
  }, [loadBoards, openBoard, createBoard])

  // 卸载前落盘
  useEffect(() => flushNow, [flushNow])

  const activeBoard = boards.find((b) => b.id === activeId) ?? null

  return {
    boards,
    activeId,
    activeBoard,
    elements,
    elementsRef,
    viewport,
    viewportRef,
    selection,
    loading,
    error,
    loadBoards,
    openBoard,
    createBoard,
    renameBoard,
    deleteBoard,
    setSelection,
    setViewport,
    flushViewport: flushNow,
    applyElements,
    addImageFiles,
    addImagePaths,
    addText,
    removeElements,
    setError,
  }
}

export type BoardStore = ReturnType<typeof useBoardStore>
