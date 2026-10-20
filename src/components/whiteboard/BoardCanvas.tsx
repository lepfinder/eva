import { useCallback, useEffect, useRef, useState } from 'react'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import {
  BringToFront,
  ChevronDown,
  ChevronUp,
  Crop,
  Maximize,
  Minus,
  Plus,
  RotateCcw,
  SendToBack,
  Trash2,
  Type,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { BoardElement, BoardImage } from '@/services/whiteboard'
import { clampScale, type BoardStore, type Viewport } from './useBoardStore'
import { BoardImageNode, type CropHandle, type ResizeCorner } from './BoardImageNode'
import { BoardTextNode, type TextHandle } from './BoardTextNode'

const MIN_ELEMENT_SIZE = 12
const MIN_TEXT_WIDTH = 16
/** 裁剪框在自然像素下的最小边长 */
const MIN_CROP_NATURAL = 8
const GRID_SIZE = 24
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|tiff?)$/i

type Session =
  | { kind: 'pan'; sx: number; sy: number; ox: number; oy: number }
  | { kind: 'move'; sx: number; sy: number; origin: Record<string, { x: number; y: number }> }
  | {
      kind: 'resizeImage'
      id: string
      corner: ResizeCorner
      sx: number
      sy: number
      origin: { x: number; y: number; w: number; h: number }
      ratio: number
    }
  | {
      kind: 'resizeText'
      id: string
      handle: TextHandle
      sx: number
      sy: number
      origin: { x: number; y: number; w: number; h: number; fontSize: number }
    }
  | {
      kind: 'crop'
      id: string
      handle: CropHandle
      sx: number
      sy: number
      /** 手势开始时的「自然像素 / 白板像素」比例，整个手势内保持不变 */
      ppx: number
      ppy: number
      origin: {
        x: number
        y: number
        w: number
        h: number
        cropX: number
        cropY: number
        cropW: number
        cropH: number
        naturalW: number
        naturalH: number
      }
    }
  | { kind: 'marquee'; sx: number; sy: number; base: string[] }

interface Box {
  x: number
  y: number
  w: number
  h: number
}

function intersects(a: BoardElement, b: Box): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

interface BoardCanvasProps {
  store: BoardStore
}

export function BoardCanvas({ store }: BoardCanvasProps): React.ReactElement {
  const {
    activeId,
    elements,
    elementsRef,
    viewport,
    viewportRef,
    selection,
    setSelection,
    setViewport,
    applyElements,
    addImageFiles,
    addImagePaths,
    addText,
    removeElements,
  } = store

  const containerRef = useRef<HTMLDivElement>(null)
  const sessionRef = useRef<Session | null>(null)
  const selectionRef = useRef<string[]>(selection)
  const sizeRef = useRef({ w: 0, h: 0 })
  const spaceRef = useRef(false)

  const [size, setSize] = useState({ w: 0, h: 0 })
  const [marquee, setMarquee] = useState<Box | null>(null)
  const [spaceDown, setSpaceDown] = useState(false)
  const [cropId, setCropId] = useState<string | null>(null)
  const [editingTextId, setEditingTextId] = useState<string | null>(null)
  const cropSnapshotRef = useRef<Extract<BoardElement, { kind: 'image' }> | null>(null)
  const cropIdRef = useRef<string | null>(null)

  selectionRef.current = selection
  cropIdRef.current = cropId

  useEffect(() => {
    sizeRef.current = size
  }, [size])

  /** 视口中心对应的白板坐标，粘贴的图片落在这里 */
  const viewportCenter = useCallback((): { x: number; y: number } => {
    const vp = viewportRef.current
    const s = sizeRef.current
    return { x: (s.w / 2 - vp.x) / vp.scale, y: (s.h / 2 - vp.y) / vp.scale }
  }, [viewportRef])

  // ── 画布尺寸 ──────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect
      setSize({ w: rect.width, h: rect.height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // 空板首次打开时把原点放到画布中心，这样第一张粘贴图正好居中
  useEffect(() => {
    if (!activeId || elements.length > 0) return
    const s = sizeRef.current
    if (s.w === 0) return
    const vp = viewportRef.current
    if (vp.x !== 0 || vp.y !== 0) return
    setViewport({ x: s.w / 2, y: s.h / 2, scale: vp.scale })
  }, [activeId, elements.length, size, setViewport, viewportRef])

  // ── 缩放 / 平移 ──────────────────────────────────
  const zoomAround = useCallback(
    (nextScale: number, anchorX: number, anchorY: number) => {
      const vp = viewportRef.current
      const scale = clampScale(nextScale)
      const bx = (anchorX - vp.x) / vp.scale
      const by = (anchorY - vp.y) / vp.scale
      setViewport({ x: anchorX - bx * scale, y: anchorY - by * scale, scale })
    },
    [setViewport, viewportRef],
  )

  const zoomByCenter = useCallback(
    (factor: number) => {
      const s = sizeRef.current
      zoomAround(viewportRef.current.scale * factor, s.w / 2, s.h / 2)
    },
    [viewportRef, zoomAround],
  )

  const resetZoom = useCallback(() => {
    const s = sizeRef.current
    zoomAround(1, s.w / 2, s.h / 2)
  }, [zoomAround])

  const fitToContent = useCallback(() => {
    const els = elementsRef.current
    const s = sizeRef.current
    if (els.length === 0 || s.w === 0) {
      resetZoom()
      return
    }
    const minX = Math.min(...els.map((i) => i.x))
    const minY = Math.min(...els.map((i) => i.y))
    const maxX = Math.max(...els.map((i) => i.x + i.w))
    const maxY = Math.max(...els.map((i) => i.y + i.h))
    const pad = 48
    const scale = clampScale(
      Math.min((s.w - pad * 2) / Math.max(maxX - minX, 1), (s.h - pad * 2) / Math.max(maxY - minY, 1)),
    )
    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2
    const next: Viewport = { x: s.w / 2 - cx * scale, y: s.h / 2 - cy * scale, scale }
    setViewport(next)
  }, [elementsRef, resetZoom, setViewport])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const vp = viewportRef.current
      if (e.ctrlKey || e.metaKey) {
        const rect = el.getBoundingClientRect()
        zoomAround(vp.scale * Math.exp(-e.deltaY * 0.01), e.clientX - rect.left, e.clientY - rect.top)
      } else {
        setViewport({ x: vp.x - e.deltaX, y: vp.y - e.deltaY, scale: vp.scale })
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [setViewport, viewportRef, zoomAround])

  // ── 层级 ─────────────────────────────────────────
  type ReorderMode = 'forward' | 'backward' | 'front' | 'back'

  const reorder = useCallback(
    (mode: ReorderMode) => {
      const sel = new Set(selectionRef.current)
      if (sel.size === 0) return
      const sorted = [...elementsRef.current].sort((a, b) => a.zIndex - b.zIndex)

      if (mode === 'front' || mode === 'back') {
        const picked = sorted.filter((i) => sel.has(i.id))
        const rest = sorted.filter((i) => !sel.has(i.id))
        const next = mode === 'front' ? [...rest, ...picked] : [...picked, ...rest]
        sorted.splice(0, sorted.length, ...next)
      } else if (mode === 'forward') {
        // 从顶向下扫，选中项与紧邻其上的未选中项交换，多选时互不越位
        for (let i = sorted.length - 2; i >= 0; i--) {
          if (sel.has(sorted[i].id) && !sel.has(sorted[i + 1].id)) {
            ;[sorted[i], sorted[i + 1]] = [sorted[i + 1], sorted[i]]
          }
        }
      } else {
        for (let i = 1; i < sorted.length; i++) {
          if (sel.has(sorted[i].id) && !sel.has(sorted[i - 1].id)) {
            ;[sorted[i], sorted[i - 1]] = [sorted[i - 1], sorted[i]]
          }
        }
      }

      const zMap = new Map(sorted.map((img, idx) => [img.id, idx]))
      applyElements(elementsRef.current.map((i) => ({ ...i, zIndex: zMap.get(i.id) as number })))
    },
    [applyElements, elementsRef],
  )

  // ── 裁剪 ─────────────────────────────────────────
  const isCropped = (img: BoardImage): boolean =>
    img.cropX > 0.5 ||
    img.cropY > 0.5 ||
    img.cropW < img.naturalWidth - 0.5 ||
    img.cropH < img.naturalHeight - 0.5

  const enterCrop = useCallback(
    (id: string) => {
      const el = elementsRef.current.find((i) => i.id === id)
      if (!el || el.kind !== 'image') return
      cropSnapshotRef.current = el
      setSelection([id])
      setCropId(id)
    },
    [elementsRef, setSelection],
  )

  const exitCrop = useCallback(
    (commit: boolean) => {
      setCropId((current) => {
        if (!current) return current
        if (!commit && cropSnapshotRef.current) {
          const snap = cropSnapshotRef.current
          applyElements(elementsRef.current.map((i) => (i.id === snap.id ? { ...snap } : i)))
        }
        cropSnapshotRef.current = null
        return null
      })
    },
    [applyElements, elementsRef],
  )

  const onImageDoubleClick = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.stopPropagation()
      enterCrop(id)
    },
    [enterCrop],
  )

  const onCropHandlePointerDown = useCallback(
    (e: React.PointerEvent, id: string, handle: CropHandle) => {
      e.stopPropagation()
      if (e.button !== 0) return
      e.preventDefault()
      const el = elementsRef.current.find((i) => i.id === id)
      if (!el || el.kind !== 'image') return
      sessionRef.current = {
        kind: 'crop',
        id,
        handle,
        sx: e.clientX,
        sy: e.clientY,
        ppx: el.cropW / Math.max(el.w, 1),
        ppy: el.cropH / Math.max(el.h, 1),
        origin: {
          x: el.x,
          y: el.y,
          w: el.w,
          h: el.h,
          cropX: el.cropX,
          cropY: el.cropY,
          cropW: el.cropW,
          cropH: el.cropH,
          naturalW: el.naturalWidth,
          naturalH: el.naturalHeight,
        },
      }
    },
    [elementsRef],
  )

  const resetCrop = useCallback(() => {
    const sel = selectionRef.current
    if (sel.length !== 1) return
    const el = elementsRef.current.find((i) => i.id === sel[0])
    if (!el || el.kind !== 'image' || !isCropped(el)) return
    // 显示比例不变，只把裁剪框还原成整图
    const ppx = el.cropW / Math.max(el.w, 1)
    const ppy = el.cropH / Math.max(el.h, 1)
    applyElements(
      elementsRef.current.map((i) =>
        i.id === el.id && i.kind === 'image'
          ? {
              ...i,
              cropX: 0,
              cropY: 0,
              cropW: i.naturalWidth,
              cropH: i.naturalHeight,
              w: i.naturalWidth / ppx,
              h: i.naturalHeight / ppy,
            }
          : i,
      ),
    )
  }, [applyElements, elementsRef])

  // ── 文字 ─────────────────────────────────────────
  const createTextAt = useCallback(
    async (bx: number, by: number) => {
      const el = await addText('双击编辑文字', bx, by)
      if (el) {
        setSelection([el.id])
        setEditingTextId(el.id)
      }
    },
    [addText, setSelection],
  )

  const onTextDoubleClick = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.stopPropagation()
      setSelection([id])
      setEditingTextId(id)
    },
    [setSelection],
  )

  const onTextCommit = useCallback(
    (id: string, text: string, h: number) => {
      setEditingTextId(null)
      if (text.trim() === '') {
        void removeElements([id])
        return
      }
      applyElements(
        elementsRef.current.map((e) => (e.id === id && e.kind === 'text' ? { ...e, text, h } : e)),
      )
    },
    [applyElements, elementsRef, removeElements],
  )

  const onTextCancel = useCallback(() => {
    setEditingTextId(null)
  }, [])

  const onTextMeasure = useCallback(
    (id: string, h: number) => {
      const el = elementsRef.current.find((e) => e.id === id)
      if (!el || el.kind !== 'text') return
      if (Math.abs(el.h - h) < 0.5) return
      applyElements(elementsRef.current.map((e) => (e.id === id ? { ...e, h } : e)))
    },
    [applyElements, elementsRef],
  )

  // ── 指针会话 ─────────────────────────────────────
  const startPan = useCallback(
    (clientX: number, clientY: number) => {
      const vp = viewportRef.current
      sessionRef.current = { kind: 'pan', sx: clientX, sy: clientY, ox: vp.x, oy: vp.y }
    },
    [viewportRef],
  )

  const onBackgroundPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (cropIdRef.current) {
        exitCrop(true)
        return
      }
      if (e.button === 1 || spaceRef.current) {
        e.preventDefault()
        startPan(e.clientX, e.clientY)
        return
      }
      if (e.button !== 0) return
      if (!e.shiftKey) setSelection([])
      sessionRef.current = {
        kind: 'marquee',
        sx: e.clientX,
        sy: e.clientY,
        base: e.shiftKey ? selectionRef.current : [],
      }
    },
    [exitCrop, setSelection, startPan],
  )

  const onBackgroundDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target !== e.currentTarget) return
      const el = containerRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const vp = viewportRef.current
      void createTextAt(
        (e.clientX - rect.left - vp.x) / vp.scale,
        (e.clientY - rect.top - vp.y) / vp.scale,
      )
    },
    [createTextAt, viewportRef],
  )

  const onElementPointerDown = useCallback(
    (e: React.PointerEvent, id: string) => {
      e.stopPropagation()
      if (cropIdRef.current && cropIdRef.current !== id) exitCrop(true)
      if (e.button === 1 || spaceRef.current) {
        e.preventDefault()
        startPan(e.clientX, e.clientY)
        return
      }
      if (e.button !== 0) return
      e.preventDefault()

      let next = selectionRef.current
      if (e.shiftKey) {
        next = next.includes(id) ? next.filter((s) => s !== id) : [...next, id]
      } else if (!next.includes(id)) {
        next = [id]
      }
      setSelection(next)

      const origin: Record<string, { x: number; y: number }> = {}
      for (const sid of next) {
        const el = elementsRef.current.find((i) => i.id === sid)
        if (el) origin[sid] = { x: el.x, y: el.y }
      }
      sessionRef.current = { kind: 'move', sx: e.clientX, sy: e.clientY, origin }
    },
    [exitCrop, elementsRef, setSelection, startPan],
  )

  const onImageHandlePointerDown = useCallback(
    (e: React.PointerEvent, id: string, corner: ResizeCorner) => {
      e.stopPropagation()
      if (e.button !== 0) return
      e.preventDefault()
      const el = elementsRef.current.find((i) => i.id === id)
      if (!el || el.kind !== 'image') return
      setSelection([id])
      sessionRef.current = {
        kind: 'resizeImage',
        id,
        corner,
        sx: e.clientX,
        sy: e.clientY,
        origin: { x: el.x, y: el.y, w: el.w, h: el.h },
        ratio: el.w / Math.max(el.h, 1),
      }
    },
    [elementsRef, setSelection],
  )

  const onTextHandlePointerDown = useCallback(
    (e: React.PointerEvent, id: string, handle: TextHandle) => {
      e.stopPropagation()
      if (e.button !== 0) return
      e.preventDefault()
      const el = elementsRef.current.find((i) => i.id === id)
      if (!el || el.kind !== 'text') return
      setSelection([id])
      sessionRef.current = {
        kind: 'resizeText',
        id,
        handle,
        sx: e.clientX,
        sy: e.clientY,
        origin: { x: el.x, y: el.y, w: el.w, h: el.h, fontSize: el.fontSize },
      }
    },
    [elementsRef, setSelection],
  )

  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      const session = sessionRef.current
      if (!session) return
      const scale = viewportRef.current.scale

      if (session.kind === 'pan') {
        setViewport({
          x: session.ox + (e.clientX - session.sx),
          y: session.oy + (e.clientY - session.sy),
          scale: viewportRef.current.scale,
        })
        return
      }

      if (session.kind === 'move') {
        const dx = (e.clientX - session.sx) / scale
        const dy = (e.clientY - session.sy) / scale
        applyElements(
          elementsRef.current.map((el) => {
            const o = session.origin[el.id]
            return o ? { ...el, x: o.x + dx, y: o.y + dy } : el
          }),
        )
        return
      }

      if (session.kind === 'resizeImage') {
        const o = session.origin
        const dx = (e.clientX - session.sx) / scale
        const dy = (e.clientY - session.sy) / scale
        // 图片默认锁宽高比，按住 Shift 才自由变形
        const lock = !e.shiftKey
        const growsRight = session.corner === 'se' || session.corner === 'ne'
        const growsDown = session.corner === 'se' || session.corner === 'sw'
        let w = growsRight ? o.w + dx : o.w - dx
        let h = lock ? w / session.ratio : growsDown ? o.h + dy : o.h - dy
        w = Math.max(MIN_ELEMENT_SIZE, w)
        h = Math.max(MIN_ELEMENT_SIZE, h)
        const x = growsRight ? o.x : o.x + o.w - w
        const y = growsDown ? o.y : o.y + o.h - h
        applyElements(
          elementsRef.current.map((el) =>
            el.id === session.id && el.kind === 'image' ? { ...el, x, y, w, h } : el,
          ),
        )
        return
      }

      if (session.kind === 'resizeText') {
        const o = session.origin
        const dx = (e.clientX - session.sx) / scale
        const growsRight = session.handle === 'e' || session.handle === 'se' || session.handle === 'ne'
        const growsDown = session.handle === 'se' || session.handle === 'sw'
        const isCorner = session.handle.length === 2
        const rawW = growsRight ? o.w + dx : o.w - dx
        if (isCorner) {
          // 角手柄等比缩放字号，文字贴图保持「贴上去」的手感
          const w = Math.max(MIN_TEXT_WIDTH, rawW)
          const factor = w / o.w
          const fontSize = Math.max(6, o.fontSize * factor)
          const h = o.h * factor
          const x = growsRight ? o.x : o.x + o.w - w
          const y = growsDown ? o.y : o.y + o.h - h
          applyElements(
            elementsRef.current.map((el) =>
              el.id === session.id && el.kind === 'text'
                ? { ...el, x, y, w, h, fontSize }
                : el,
            ),
          )
        } else {
          const w = Math.max(MIN_TEXT_WIDTH, rawW)
          const x = growsRight ? o.x : o.x + o.w - w
          applyElements(
            elementsRef.current.map((el) =>
              el.id === session.id && el.kind === 'text' ? { ...el, x, w } : el,
            ),
          )
        }
        return
      }

      if (session.kind === 'crop') {
        const o = session.origin
        const dxN = ((e.clientX - session.sx) / scale) * session.ppx
        const dyN = ((e.clientY - session.sy) / scale) * session.ppy
        let cropX = o.cropX
        let cropY = o.cropY
        let cropW = o.cropW
        let cropH = o.cropH
        const min = MIN_CROP_NATURAL
        if (session.handle.includes('e')) {
          cropW = Math.max(min, Math.min(o.cropW + dxN, o.naturalW - o.cropX))
        }
        if (session.handle.includes('w')) {
          const nw = Math.max(min, Math.min(o.cropW - dxN, o.cropX + o.cropW))
          cropX = o.cropX + o.cropW - nw
          cropW = nw
        }
        if (session.handle.includes('s')) {
          cropH = Math.max(min, Math.min(o.cropH + dyN, o.naturalH - o.cropY))
        }
        if (session.handle.includes('n')) {
          const nh = Math.max(min, Math.min(o.cropH - dyN, o.cropY + o.cropH))
          cropY = o.cropY + o.cropH - nh
          cropH = nh
        }
        // 白板像素 / 自然像素 比例在手势内恒定，所以框随裁剪框等比收缩
        const w = cropW / session.ppx
        const h = cropH / session.ppy
        const x = session.handle.includes('w') ? o.x + (o.w - w) : o.x
        const y = session.handle.includes('n') ? o.y + (o.h - h) : o.y
        applyElements(
          elementsRef.current.map((el) =>
            el.id === session.id && el.kind === 'image'
              ? { ...el, x, y, w, h, cropX, cropY, cropW, cropH }
              : el,
          ),
        )
        return
      }

      const el = containerRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const vp = viewportRef.current
      const toBoard = (cx: number, cy: number) => ({
        x: (cx - rect.left - vp.x) / vp.scale,
        y: (cy - rect.top - vp.y) / vp.scale,
      })
      const a = toBoard(session.sx, session.sy)
      const b = toBoard(e.clientX, e.clientY)
      const box: Box = {
        x: Math.min(a.x, b.x),
        y: Math.min(a.y, b.y),
        w: Math.abs(b.x - a.x),
        h: Math.abs(b.y - a.y),
      }
      setMarquee(box)
      const hit = elementsRef.current.filter((i) => intersects(i, box)).map((i) => i.id)
      setSelection(Array.from(new Set([...session.base, ...hit])))
    }

    const endSession = () => {
      sessionRef.current = null
      setMarquee(null)
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', endSession)
    window.addEventListener('pointercancel', endSession)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', endSession)
      window.removeEventListener('pointercancel', endSession)
    }
  }, [applyElements, elementsRef, setSelection, setViewport, viewportRef])

  // ── 键盘 ─────────────────────────────────────────
  useEffect(() => {
    const isTyping = (t: EventTarget | null) => {
      const el = t as HTMLElement | null
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return
      const meta = e.metaKey || e.ctrlKey
      if (e.code === 'Space' && !meta) {
        if (!e.repeat) {
          spaceRef.current = true
          setSpaceDown(true)
        }
        e.preventDefault()
        return
      }
      if (meta && e.key === ']') {
        e.preventDefault()
        reorder(e.shiftKey ? 'front' : 'forward')
        return
      }
      if (meta && e.key === '[') {
        e.preventDefault()
        reorder(e.shiftKey ? 'back' : 'backward')
        return
      }
      if (meta && e.key === '0') {
        e.preventDefault()
        resetZoom()
        return
      }
      if (meta && e.key === '1') {
        e.preventDefault()
        fitToContent()
        return
      }
      if (meta && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        setSelection(elementsRef.current.map((i) => i.id))
        return
      }
      if (!meta && (e.key === 'Delete' || e.key === 'Backspace')) {
        const sel = selectionRef.current
        if (sel.length === 0) return
        e.preventDefault()
        void removeElements(sel)
        return
      }
      if (cropIdRef.current && (e.key === 'Enter' || e.key === 'Escape')) {
        e.preventDefault()
        exitCrop(e.key === 'Enter')
        return
      }
      if (e.key === 'Escape') setSelection([])
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceRef.current = false
        setSpaceDown(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [exitCrop, fitToContent, elementsRef, removeElements, reorder, resetZoom, setSelection])

  // ── 粘贴图片 ─────────────────────────────────────
  useEffect(() => {
    if (!activeId) return
    const onPaste = (e: ClipboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      const items = e.clipboardData?.items
      if (!items?.length) return
      const files: File[] = []
      for (const item of Array.from(items)) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) files.push(file)
        }
      }
      if (files.length === 0) return
      e.preventDefault()
      void addImageFiles(files, viewportCenter()).then((added) => {
        if (added.length > 0) setSelection(added.map((a) => a.id))
      })
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [activeId, addImageFiles, setSelection, viewportCenter])

  // ── 拖文件入板（Tauri 拦截了 HTML5 drop，只能走原生事件） ──
  useEffect(() => {
    if (!activeId) return
    let unlisten: (() => void) | null = null
    let disposed = false
    getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type !== 'drop') return
        const paths = event.payload.paths.filter((p) => IMAGE_EXT.test(p))
        if (paths.length === 0) return
        void addImagePaths(paths, viewportCenter())
      })
      .then((fn) => {
        if (disposed) fn()
        else unlisten = fn
      })
      .catch(() => {})
    return () => {
      disposed = true
      if (unlisten) unlisten()
    }
  }, [activeId, addImagePaths, viewportCenter])

  const cursor = spaceDown ? (sessionRef.current?.kind === 'pan' ? 'grabbing' : 'grab') : 'default'
  const gridPx = GRID_SIZE * viewport.scale
  const scalePercent = Math.round(viewport.scale * 100)
  const singleSelected =
    selection.length === 1 ? elements.find((i) => i.id === selection[0]) ?? null : null
  const singleImage = singleSelected?.kind === 'image' ? singleSelected : null
  const sorted = [...elements].sort((a, b) => a.zIndex - b.zIndex)

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div
        ref={containerRef}
        className="h-full w-full text-zinc-300 dark:text-zinc-700"
        style={{
          cursor,
          touchAction: 'none',
          backgroundImage: 'radial-gradient(circle, currentColor 1px, transparent 1px)',
          backgroundSize: `${gridPx}px ${gridPx}px`,
          backgroundPosition: `${viewport.x}px ${viewport.y}px`,
        }}
        onPointerDown={onBackgroundPointerDown}
        onDoubleClick={onBackgroundDoubleClick}
      >
        <div
          className="absolute left-0 top-0 origin-top-left"
          style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})` }}
        >
          {sorted.map((el) =>
            el.kind === 'image' ? (
              <BoardImageNode
                key={el.id}
                image={el}
                selected={selection.includes(el.id)}
                cropping={cropId === el.id}
                scale={viewport.scale}
                onPointerDownBody={onElementPointerDown}
                onPointerDownHandle={onImageHandlePointerDown}
                onPointerDownCropHandle={onCropHandlePointerDown}
                onDoubleClick={onImageDoubleClick}
              />
            ) : (
              <BoardTextNode
                key={el.id}
                el={el}
                selected={selection.includes(el.id)}
                editing={editingTextId === el.id}
                scale={viewport.scale}
                onPointerDownBody={onElementPointerDown}
                onPointerDownHandle={onTextHandlePointerDown}
                onDoubleClick={onTextDoubleClick}
                onCommit={onTextCommit}
                onCancel={onTextCancel}
                onMeasure={onTextMeasure}
              />
            ),
          )}
          {marquee && (
            <div
              className="pointer-events-none absolute"
              style={{
                left: marquee.x,
                top: marquee.y,
                width: marquee.w,
                height: marquee.h,
                border: `${1 / viewport.scale}px solid hsl(var(--primary))`,
                background: 'hsl(var(--primary) / 0.08)',
              }}
            />
          )}
        </div>

        {elements.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <p className="text-sm text-zinc-500">粘贴图片到这里</p>
              <p className="mt-1 font-mono text-[11px] text-zinc-400">
                ⌘V · 拖入文件 · 双击空白加文字 · 滚轮平移 · ⌘滚轮缩放
              </p>
            </div>
          </div>
        )}
      </div>

      {/* 工具条 */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-3">
        <div className="pointer-events-auto flex items-center gap-1 rounded-md border bg-background/95 px-1 py-0.5 shadow-sm backdrop-blur">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => zoomByCenter(1 / 1.2)} title="缩小">
            <Minus className="h-3.5 w-3.5" />
          </Button>
          <button
            className="w-12 font-mono text-[11px] text-muted-foreground hover:text-foreground"
            onClick={resetZoom}
            title="恢复 100% (⌘0)"
          >
            {scalePercent}%
          </button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => zoomByCenter(1.2)} title="放大">
            <Plus className="h-3.5 w-3.5" />
          </Button>
          <div className="mx-0.5 h-4 w-px bg-border" />
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={fitToContent} title="适应内容 (⌘1)">
            <Maximize className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => {
              const c = viewportCenter()
              void createTextAt(c.x, c.y)
            }}
            title="加文字（或双击空白处）"
          >
            <Type className="h-3.5 w-3.5" />
          </Button>
          <div className="mx-0.5 h-4 w-px bg-border" />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={selection.length === 0}
            onClick={() => reorder('back')}
            title="置底 (⌘⇧[)"
          >
            <SendToBack className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={selection.length === 0}
            onClick={() => reorder('backward')}
            title="下移一层 (⌘[)"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={selection.length === 0}
            onClick={() => reorder('forward')}
            title="上移一层 (⌘])"
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={selection.length === 0}
            onClick={() => reorder('front')}
            title="置顶 (⌘⇧])"
          >
            <BringToFront className="h-3.5 w-3.5" />
          </Button>
          <div className="mx-0.5 h-4 w-px bg-border" />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={!singleImage}
            onClick={() => {
              if (!singleImage) return
              if (cropId === singleImage.id) exitCrop(true)
              else enterCrop(singleImage.id)
            }}
            title={cropId ? '完成裁剪 (Enter)' : '裁剪（或双击图片）'}
          >
            <Crop className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={!singleImage || !isCropped(singleImage)}
            onClick={resetCrop}
            title="重置裁剪"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
          <div className="mx-0.5 h-4 w-px bg-border" />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={selection.length === 0}
            onClick={() => void removeElements(selection)}
            title="删除选中 (Delete)"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>

        <div className="pointer-events-none rounded-md bg-background/80 px-2 py-1 font-mono text-[11px] text-muted-foreground backdrop-blur">
          {elements.length} 元素{selection.length > 0 ? ` · 选中 ${selection.length}` : ''}
        </div>
      </div>
    </div>
  )
}
