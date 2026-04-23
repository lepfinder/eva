import { Terminal } from 'lucide-react'
import { CheatSheetDetailView } from './CheatSheetDetailView'
import type { CheatSoftware } from './types'

export const TMUX_CHEAT_SHEET: CheatSoftware = {
  id: 'tmux',
  name: 'Tmux',
  description: '终端会话、窗口和面板管理',
  icon: <Terminal className="h-4 w-4" />,
  color: 'bg-orange-500',
  sectionColors: ['bg-orange-500', 'bg-amber-600', 'bg-orange-600', 'bg-amber-500'],
  sections: [
    {
      title: '会话管理',
      items: [
        { command: 'tmux', description: '启动新会话' },
        { command: 'tmux new -s <name>', description: '创建命名会话' },
        { command: 'tmux ls', description: '列出所有会话' },
        { command: 'tmux attach -t <name>', description: '连接到指定会话' },
        { command: 'tmux kill-session -t <name>', description: '销毁指定会话' },
        { command: 'tmux kill-server', description: '销毁所有会话' },
        { command: 'Prefix + d', description: '分离当前会话' },
        { command: 'Prefix + $', description: '重命名当前会话' },
        { command: 'Prefix + s', description: '列出会话并切换' },
      ],
    },
    {
      title: '窗口操作',
      items: [
        { command: 'Prefix + c', description: '创建新窗口' },
        { command: 'Prefix + ,', description: '重命名当前窗口' },
        { command: 'Prefix + n', description: '切换到下一窗口' },
        { command: 'Prefix + p', description: '切换到上一窗口' },
        { command: 'Prefix + 0~9', description: '按编号切换窗口' },
        { command: 'Prefix + w', description: '列出窗口并切换' },
        { command: 'Prefix + &', description: '关闭当前窗口' },
        { command: 'Prefix + f', description: '按名称搜索窗口' },
      ],
    },
    {
      title: '面板（Pane）操作',
      items: [
        { command: 'Prefix + %', description: '垂直分割面板' },
        { command: 'Prefix + "', description: '水平分割面板' },
        { command: 'Prefix + 方向键', description: '在面板间切换' },
        { command: 'Prefix + o', description: '切换到下一面板' },
        { command: 'Prefix + x', description: '关闭当前面板' },
        { command: 'Prefix + z', description: '最大化/还原面板' },
        { command: 'Prefix + {', description: '将面板向前移动' },
        { command: 'Prefix + }', description: '将面板向后移动' },
        { command: 'Prefix + Space', description: '轮换面板布局' },
        { command: 'Prefix + q', description: '显示面板编号' },
      ],
    },
    {
      title: '复制模式',
      items: [
        { command: 'Prefix + [', description: '进入复制模式' },
        { command: 'Space', description: '开始选择文本（vi 模式）' },
        { command: 'Enter', description: '复制选中文本' },
        { command: 'Prefix + ]', description: '粘贴缓冲区内容' },
        { command: 'q / Esc', description: '退出复制模式' },
      ],
    },
  ],
}

export function TmuxCheatSheetPage({ onBack }: { onBack: () => void }): React.ReactElement {
  return <CheatSheetDetailView software={TMUX_CHEAT_SHEET} onBack={onBack} />
}
