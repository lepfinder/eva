import { memo, useMemo } from 'react'
import { convertFileSrc } from '@tauri-apps/api/core'
import type { BoardImage } from '@/services/whiteboard'

export type ResizeCorner = 'nw' | 'ne' | 'sw' | 'se'
export type CropHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

interface BoardImageNodeProps {
  image: BoardImage
  selected: boolean
  cropping: boolean
  /** 视口缩放，用于让描边与手柄在屏幕上保持恒定尺寸 */
  scale: number
  onPointerDownBody: (e: React.PointerEvent, id: string) => void
  onPointerDownHandle: (e: React.PointerEvent, id: string, corner: ResizeCorner) => void
  onPointerDownCropHandle: (e: React.PointerEvent, id: string, handle: CropHandle) => void
  onDoubleClick: (e: React.MouseEvent, id: string) => void
}

const RESIZE_CORNERS: { corner: ResizeCorner; cursor: string; style: React.CSSProperties }[] = [
  { corner: 'nw', cursor: 'nwse-resize', style: { left: 0, top: 0, transform: 'translate(-50%, -50%)' } },
  { corner: 'ne', cursor: 'nesw-resize', style: { right: 0, top: 0, transform: 'translate(50%, -50%)' } },
  { corner: 'sw', cursor: 'nesw-resize', style: { left: 0, bottom: 0, transform: 'translate(-50%, 50%)' } },
  { corner: 'se', cursor: 'nwse-resize', style: { right: 0, bottom: 0, transform: 'translate(50%, 50%)' } },
]

const CROP_HANDLES: { handle: CropHandle; cursor: string; style: React.CSSProperties }[] = [
  { handle: 'nw', cursor: 'nwse-resize', style: { left: 0, top: 0, transform: 'translate(-50%, -50%)' } },
  { handle: 'n', cursor: 'ns-resize', style: { left: '50%', top: 0, transform: 'translate(-50%, -50%)' } },
  { handle: 'ne', cursor: 'nesw-resize', style: { left: '100%', top: 0, transform: 'translate(-50%, -50%)' } },
  { handle: 'e', cursor: 'ew-resize', style: { left: '100%', top: '50%', transform: 'translate(-50%, -50%)' } },
  { handle: 'se', cursor: 'nwse-resize', style: { left: '100%', top: '100%', transform: 'translate(-50%, -50%)' } },
  { handle: 's', cursor: 'ns-resize', style: { left: '50%', top: '100%', transform: 'translate(-50%, -50%)' } },
  { handle: 'sw', cursor: 'nesw-resize', style: { left: 0, top: '100%', transform: 'translate(-50%, -50%)' } },
  { handle: 'w', cursor: 'ew-resize', style: { left: 0, top: '50%', transform: 'translate(-50%, -50%)' } },
]

function BoardImageNodeInner({
  image,
  selected,
  cropping,
  scale,
  onPointerDownBody,
  onPointerDownHandle,
  onPointerDownCropHandle,
  onDoubleClick,
}: BoardImageNodeProps): React.ReactElement {
  const src = useMemo(() => convertFileSrc(image.filePath), [image.filePath])
  const handleSize = 9 / scale
  const ringInner = 1 / scale
  const ringOuter = 1.5 / scale
  const accent = 'hsl(var(--primary))'

  // 裁剪态：把整张图铺开，裁剪框画在上面，框外压暗
  if (cropping) {
    const ppx = image.cropW / Math.max(image.w, 1)
    const ppy = image.cropH / Math.max(image.h, 1)
    const fullW = image.naturalWidth / ppx
    const fullH = image.naturalHeight / ppy
    return (
      <div
        className="absolute select-none overflow-hidden"
        style={{
          left: image.x - image.cropX / ppx,
          top: image.y - image.cropY / ppy,
          width: fullW,
          height: fullH,
          zIndex: 999999,
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <img
          src={src}
          alt=""
          draggable={false}
          className="h-full w-full"
          style={{ pointerEvents: 'none', objectFit: 'fill' }}
        />
        <div
          className="absolute"
          style={{
            left: image.cropX / ppx,
            top: image.cropY / ppy,
            width: image.cropW / ppx,
            height: image.cropH / ppy,
            boxShadow: `0 0 0 ${ringInner}px ${accent}, 0 0 0 99999px rgba(0,0,0,0.5)`,
          }}
        >
          {CROP_HANDLES.map(({ handle, cursor, style }) => (
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
              onPointerDown={(e) => onPointerDownCropHandle(e, image.id, handle)}
            />
          ))}
        </div>
      </div>
    )
  }

  // 常规态：外层 w×h 裁切窗口，内层 img 按裁剪框反算尺寸与偏移
  const innerW = image.w / (image.cropW / Math.max(image.naturalWidth, 1))
  const innerH = image.h / (image.cropH / Math.max(image.naturalHeight, 1))
  const innerLeft = -(image.cropX / Math.max(image.naturalWidth, 1)) * innerW
  const innerTop = -(image.cropY / Math.max(image.naturalHeight, 1)) * innerH

  return (
    <div
      className="absolute select-none overflow-hidden"
      style={{
        left: image.x,
        top: image.y,
        width: image.w,
        height: image.h,
        zIndex: image.zIndex,
        boxShadow: selected
          ? `0 0 0 ${ringInner}px #fff, 0 0 0 ${ringInner + ringOuter}px ${accent}`
          : undefined,
      }}
      onPointerDown={(e) => onPointerDownBody(e, image.id)}
      onDoubleClick={(e) => onDoubleClick(e, image.id)}
    >
      <img
        src={src}
        alt=""
        draggable={false}
        className="absolute max-w-none"
        style={{
          left: innerLeft,
          top: innerTop,
          width: innerW,
          height: innerH,
          pointerEvents: 'none',
          objectFit: 'fill',
        }}
      />
      {selected &&
        RESIZE_CORNERS.map(({ corner, cursor, style }) => (
          <div
            key={corner}
            className="absolute rounded-[1px] border bg-white"
            style={{
              ...style,
              width: handleSize,
              height: handleSize,
              cursor,
              touchAction: 'none',
              borderColor: accent,
            }}
            onPointerDown={(e) => onPointerDownHandle(e, image.id, corner)}
          />
        ))}
    </div>
  )
}

export const BoardImageNode = memo(BoardImageNodeInner)
