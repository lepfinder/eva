import { FileCode } from 'lucide-react'
import { CheatSheetDetailView } from './CheatSheetDetailView'
import type { CheatSoftware } from './types'

export const VIM_CHEAT_SHEET: CheatSoftware = {
  id: 'vim',
  name: 'Vim',
  description: '编辑器模式、移动和高效操作',
  icon: <FileCode className="h-4 w-4" />,
  color: 'bg-violet-600',
  sectionColors: ['bg-violet-600', 'bg-purple-600', 'bg-violet-700', 'bg-purple-500', 'bg-fuchsia-600'],
  sections: [
    {
      title: '模式切换',
      items: [
        { command: 'i', description: '在光标前进入插入模式' },
        { command: 'a', description: '在光标后进入插入模式' },
        { command: 'I', description: '在行首进入插入模式' },
        { command: 'A', description: '在行尾进入插入模式' },
        { command: 'o', description: '在下方新建行并插入' },
        { command: 'O', description: '在上方新建行并插入' },
        { command: 'v / V', description: '可视模式（字符/行）' },
        { command: 'Ctrl + v', description: '进入可视块模式' },
        { command: 'Esc', description: '返回普通模式' },
        { command: ':', description: '进入命令行模式' },
      ],
    },
    {
      title: '光标移动',
      items: [
        { command: 'h / j / k / l', description: '左 / 下 / 上 / 右' },
        { command: 'w / W', description: '移到下一单词开头' },
        { command: 'b / B', description: '移到上一单词开头' },
        { command: 'e / E', description: '移到单词末尾' },
        { command: '0 / $', description: '行首 / 行尾' },
        { command: 'gg / G', description: '文件开头 / 结尾' },
        { command: '<n>G', description: '跳到第 n 行' },
        { command: 'Ctrl + d / u', description: '下/上滚动半页' },
        { command: 'Ctrl + f / b', description: '下/上翻整页' },
        { command: '%', description: '跳转到匹配括号' },
      ],
    },
    {
      title: '编辑操作',
      items: [
        { command: 'dd', description: '删除（剪切）当前行' },
        { command: 'D', description: '删除到行尾' },
        { command: 'dw', description: '删除一个单词' },
        { command: 'yy', description: '复制当前行' },
        { command: 'yw', description: '复制一个单词' },
        { command: 'p / P', description: '在光标后/前粘贴' },
        { command: 'u / Ctrl + r', description: '撤销 / 重做' },
        { command: 'ciw', description: '修改整个单词' },
        { command: 'ci"', description: '修改引号内内容' },
        { command: 'x', description: '删除光标处字符' },
        { command: 'r<char>', description: '替换光标处字符' },
        { command: '.', description: '重复上次操作' },
        { command: '> / <', description: '增加/减少缩进' },
      ],
    },
    {
      title: '搜索与替换',
      items: [
        { command: '/<pattern>', description: '向后搜索' },
        { command: '?<pattern>', description: '向前搜索' },
        { command: 'n / N', description: '下/上一个匹配' },
        { command: '*', description: '搜索光标下的单词' },
        { command: ':%s/old/new/g', description: '全局替换' },
        { command: ':%s/old/new/gc', description: '全局替换（逐一确认）' },
        { command: ':n,ms/old/new/g', description: '替换 n 到 m 行' },
      ],
    },
    {
      title: '文件操作',
      items: [
        { command: ':w', description: '保存' },
        { command: ':w <file>', description: '另存为指定文件' },
        { command: ':q / :q!', description: '退出 / 强制退出' },
        { command: ':wq / :x', description: '保存并退出' },
        { command: ':e <file>', description: '打开文件' },
        { command: ':sp / :vsp <file>', description: '水平/垂直分屏打开' },
        { command: 'Ctrl + w + w', description: '在分屏间切换' },
      ],
    },
  ],
}

export function VimCheatSheetPage({ onBack }: { onBack: () => void }): React.ReactElement {
  return <CheatSheetDetailView software={VIM_CHEAT_SHEET} onBack={onBack} />
}
