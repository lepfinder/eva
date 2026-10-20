import { invoke } from '@tauri-apps/api/core'

export interface Board {
  id: string
  name: string
  sortOrder: number
  viewportX: number
  viewportY: number
  viewportScale: number
  imageCount: number
  coverPath: string | null
  createdAt: number
  updatedAt: number
}

export interface BoardImage {
  id: string
  boardId: string
  filePath: string
  thumbPath: string | null
  naturalWidth: number
  naturalHeight: number
  cropX: number
  cropY: number
  cropW: number
  cropH: number
  x: number
  y: number
  w: number
  h: number
  zIndex: number
  createdAt: number
}

export interface BoardDetail {
  board: Board
  images: BoardImage[]
  texts: BoardText[]
}

export interface BoardText {
  id: string
  boardId: string
  text: string
  /** 'auto' 跟随主题，或 #rrggbb */
  color: string
  fontSize: number
  x: number
  y: number
  w: number
  h: number
  zIndex: number
  createdAt: number
}

export type BoardElement =
  | ({ kind: 'image' } & BoardImage)
  | ({ kind: 'text' } & BoardText)

export interface TextTransform {
  id: string
  text: string
  color: string
  fontSize: number
  x: number
  y: number
  w: number
  h: number
  zIndex: number
}

export interface ImageTransform {
  id: string
  x: number
  y: number
  w: number
  h: number
  zIndex: number
  cropX: number
  cropY: number
  cropW: number
  cropH: number
}

export const MIN_SCALE = 0.1
export const MAX_SCALE = 4

export const whiteboardApi = {
  listBoards: () => invoke<Board[]>('whiteboard_list_boards'),

  createBoard: (name?: string) => invoke<Board>('whiteboard_create_board', { name }),

  renameBoard: (id: string, name: string) =>
    invoke<Board>('whiteboard_rename_board', { id, name }),

  deleteBoard: (id: string) => invoke<void>('whiteboard_delete_board', { id }),

  getBoard: (id: string) => invoke<BoardDetail>('whiteboard_get_board', { id }),

  saveViewport: (id: string, x: number, y: number, scale: number) =>
    invoke<void>('whiteboard_save_viewport', { id, x, y, scale }),

  addImageFromBytes: (boardId: string, dataBase64: string, centerX: number, centerY: number) =>
    invoke<BoardImage>('whiteboard_add_image_from_bytes', {
      boardId,
      dataBase64,
      centerX,
      centerY,
    }),

  addImageFromPath: (boardId: string, path: string, centerX: number, centerY: number) =>
    invoke<BoardImage>('whiteboard_add_image_from_path', { boardId, path, centerX, centerY }),

  updateImagesBatch: (boardId: string, items: ImageTransform[]) =>
    invoke<void>('whiteboard_update_images_batch', { boardId, items }),

  deleteImages: (boardId: string, ids: string[]) =>
    invoke<void>('whiteboard_delete_images', { boardId, ids }),

  addText: (
    boardId: string,
    text: string,
    x: number,
    y: number,
    fontSize: number,
    color: string,
  ) => invoke<BoardText>('whiteboard_add_text', { boardId, text, x, y, fontSize, color }),

  updateTextsBatch: (boardId: string, items: TextTransform[]) =>
    invoke<void>('whiteboard_update_texts_batch', { boardId, items }),

  deleteTexts: (boardId: string, ids: string[]) =>
    invoke<void>('whiteboard_delete_texts', { boardId, ids }),
}
