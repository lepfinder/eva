import { GitBranch } from 'lucide-react'
import { CheatSheetDetailView } from './CheatSheetDetailView'
import type { CheatSoftware } from './types'

export const GIT_CHEAT_SHEET: CheatSoftware = {
  id: 'git',
  name: 'Git',
  description: '版本控制与协作命令速查',
  icon: <GitBranch className="h-4 w-4" />,
  color: 'bg-blue-600',
  sectionColors: ['bg-blue-600', 'bg-blue-500', 'bg-indigo-600', 'bg-sky-600'],
  sections: [
    {
      title: '基础操作',
      items: [
        { command: 'git init', description: '初始化本地仓库' },
        { command: 'git clone <url>', description: '克隆远程仓库' },
        { command: 'git status', description: '查看工作区状态' },
        { command: 'git add .', description: '暂存所有更改' },
        { command: 'git add <file>', description: '暂存指定文件' },
        { command: 'git commit -m "msg"', description: '提交暂存区' },
        { command: 'git push', description: '推送到远程' },
        { command: 'git pull', description: '拉取并合并远程' },
        { command: 'git fetch', description: '拉取远程但不合并' },
      ],
    },
    {
      title: '分支管理',
      items: [
        { command: 'git branch', description: '列出所有本地分支' },
        { command: 'git branch <name>', description: '创建新分支' },
        { command: 'git checkout <name>', description: '切换到分支' },
        { command: 'git checkout -b <name>', description: '创建并切换分支' },
        { command: 'git switch -c <name>', description: '创建并切换（新语法）' },
        { command: 'git merge <name>', description: '合并指定分支到当前' },
        { command: 'git rebase <name>', description: '变基到指定分支' },
        { command: 'git branch -d <name>', description: '删除已合并分支' },
        { command: 'git branch -D <name>', description: '强制删除分支' },
      ],
    },
    {
      title: '历史与回退',
      items: [
        { command: 'git log --oneline', description: '简洁历史日志' },
        { command: 'git log --graph', description: '图形化分支历史' },
        { command: 'git diff', description: '工作区与暂存区差异' },
        { command: 'git diff HEAD', description: '与最新提交的差异' },
        { command: 'git stash', description: '临时储藏当前更改' },
        { command: 'git stash pop', description: '恢复最近一次储藏' },
        { command: 'git stash list', description: '列出所有储藏' },
        { command: 'git reset --soft HEAD~1', description: '撤销最近提交，保留修改' },
        { command: 'git reset --hard HEAD~1', description: '撤销最近提交，丢弃修改' },
        { command: 'git revert <hash>', description: '生成新提交撤销指定提交' },
        { command: 'git cherry-pick <hash>', description: '摘取指定提交到当前分支' },
      ],
    },
    {
      title: '远程管理',
      items: [
        { command: 'git remote -v', description: '查看远程仓库列表' },
        { command: 'git remote add origin <url>', description: '添加远程仓库' },
        { command: 'git push -u origin <name>', description: '推送并设置上游分支' },
        { command: 'git push origin --delete <name>', description: '删除远程分支' },
        { command: 'git tag <name>', description: '创建轻量标签' },
        { command: 'git tag -a <name> -m "msg"', description: '创建附注标签' },
        { command: 'git push origin --tags', description: '推送所有标签' },
      ],
    },
  ],
}

export function GitCheatSheetPage({ onBack }: { onBack: () => void }): React.ReactElement {
  return <CheatSheetDetailView software={GIT_CHEAT_SHEET} onBack={onBack} />
}
