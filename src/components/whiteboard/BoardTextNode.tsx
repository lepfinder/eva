import { memo, useLayoutEffect, useRef, useState } from 'react'
import type { BoardText } from '@/services/whiteboard'
import type { ResizeCorner } from './BoardImageNode'

export type TextHandle = ResizeCorner | 'e' | 'w'

interface BoardTextNodeProps {
  el: BoardText
  selected: boolean
  editing: boolean
  /** 视口缩放，用于让描边与手柄在屏幕上保持恒定尺寸 */
  scale: number
  onPointerDownBody: (e: React.PointerEvent, id: string) => void
  onPointerDownHandle: (e: React.PointerEvent, id: string, handle: TextHandle) => void
  onDoubleClick: (e: React.MouseEvent, id: string) => void
  onCommit: (id: string, text: string, h: number) => void
  onCancel: () => void
  onMeasure: (id: string, h: number) => void
}

const TEXT_HANDLES: { handle: TextHandle; cursor: string; style: React.CSSProperties }[] = [
  { handle: 'nw', cursor: 'nwse-resize', style: { left: 0, top: 0, transform: 'translate(-50%, -50%)' } },
  { handle: 'ne', cursor: 'nesw-resize', style: { left: '100%', top: 0, transform: 'translate(-50%, -50%)' } },
  { handle: 'sw', cursor: 'nesw-resize', style: { left: 0, top: '100%', transform: 'translate(-50%, -50%)' } },
  { handle: 'se', cursor: 'nwse-resize', style: { left: '100%', top: '100%', transform: 'translate(-50%, -50%)' } },
  { handle: 'e', cursor: 'ew-resize', style: { left: '100%', top: '50%', transform: 'translate(-50%, -50%)' } },
  { handle: 'w', cursor: 'ew-resize', style: { left: 0, top: '50%', transform: 'translate(-50%, -50%)' } },
]

const LINE_HEIGHT = 1.35

function BoardTextNodeInner({
  el,
  selected,
  editing,
  scale,
  onPointerDownBody,
  onPointerDownHandle,
  onDoubleClick,
  onCommit,
  onCancel,
  onMeasure,
}: BoardTextNodeProps): React.ReactElement {
  const contentRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const [draft, setDraft] = useState(el.text)

  const accent = 'hsl(var(--primary))'
  const handleSize = 9 / scale
  const color = el.color === 'auto' ? undefined : el.color

  useLayoutEffect(() => {
    const node = contentRef.current
    if (!node || editing) return
    const ro = new ResizeObserver(() => onMeasure(el.id, node.offsetHeight))
    ro.observe(node)
    onMeasure(el.id, node.offsetHeight)
    return () => ro.disconnect()
  }, [editing, el.id, el.text, el.fontSize, el.w, onMeasure])

  useLayoutEffect(() => {
    if (!editing) return
    setDraft(el.text)
    const ta = taRef.current
    if (ta) {
      ta.style.height = 'auto'
      ta.style.height = `${ta.scrollHeight}px`
      ta.focus()
      ta.select()
    }
    // 仅在进入编辑态时同步一次草稿
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing])

  if (editing) {
    return (
      <textarea
        ref={taRef}
        value={draft}
        spellCheck={false}
        className="text-foreground"
        style={{
          position: 'absolute',
          left: el.x,
          top: el.y,
          width: el.w,
          fontSize: el.fontSize,
          lineHeight: LINE_HEIGHT,
          color,
          background: 'transparent',
          border: `1px dashed ${accent}`,
          outline: 'none',
          resize: 'none',
          overflow: 'hidden',
          padding: 0,
          margin: 0,
          fontFamily: 'inherit',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          zIndex: 999999,
        }}
        onChange={(e) => {
          setDraft(e.target.value)
          const ta = taRef.current
          if (ta) {
            ta.style.height = 'auto'
            ta.style.height = `${ta.scrollHeight}px`
          }
        }}
        onBlur={() => onCommit(el.id, draft, taRef.current?.scrollHeight ?? el.h)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Escape') {
            e.preventDefault()
            onCancel()
          }
        }}
        onPointerDown={(e) => e.stopPropagation()}
      />
    )
  }

  return (
    <div
      className="absolute select-none"
      style={{
        left: el.x,
        top: el.y,
        width: el.w,
        minHeight: el.h,
        zIndex: el.zIndex,
        boxShadow: selected
          ? `0 0 0 ${1 / scale}px #fff, 0 0 0 ${2.5 / scale}px ${accent}`
          : undefined,
      }}
      onPointerDown={(e) => onPointerDownBody(e, el.id)}
      onDoubleClick={(e) => onDoubleClick(e, el.id)}
    >
      <div
        ref={contentRef}
        className="text-foreground"
        style={{
          fontSize: el.fontSize,
          lineHeight: LINE_HEIGHT,
          color,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {el.text}
      </div>
      {selected &&
        TEXT_HANDLES.map(({ handle, cursor, style }) => (
          <div
            key={handle}
            className="absolute rounded-[1px] border bg-white"
            style={{
              ...style,
              width: handleSize,
              height: handleSize,
              cursor,
              touchAction: 'none',
              borderColor: accent,
            }}
            onPointerDown={(e) => onPointerDownHandle(e, el.id, handle)}
          />
        ))}
    </div>
  )
}

export const BoardTextNode = memo(BoardTextNodeInner)
