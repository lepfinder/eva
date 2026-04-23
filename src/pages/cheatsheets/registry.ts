import type { CheatSoftware } from './types'
import { CompressCheatSheetPage, COMPRESS_CHEAT_SHEET } from './CompressCheatSheetPage'
import { GitCheatSheetPage, GIT_CHEAT_SHEET } from './GitCheatSheetPage'
import { TmuxCheatSheetPage, TMUX_CHEAT_SHEET } from './TmuxCheatSheetPage'
import { VimCheatSheetPage, VIM_CHEAT_SHEET } from './VimCheatSheetPage'

export const CHEAT_SOFTWARES: CheatSoftware[] = [
  GIT_CHEAT_SHEET,
  TMUX_CHEAT_SHEET,
  VIM_CHEAT_SHEET,
  COMPRESS_CHEAT_SHEET,
]

export type SoftwareId = (typeof CHEAT_SOFTWARES)[number]['id']

export const DETAIL_PAGE_MAP: Record<SoftwareId, ({ onBack }: { onBack: () => void }) => React.ReactElement> = {
  git: GitCheatSheetPage,
  tmux: TmuxCheatSheetPage,
  vim: VimCheatSheetPage,
  compress: CompressCheatSheetPage,
}
