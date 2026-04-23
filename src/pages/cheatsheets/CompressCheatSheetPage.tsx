import { Archive } from 'lucide-react'
import { CheatSheetDetailView } from './CheatSheetDetailView'
import type { CheatSoftware } from './types'

export const COMPRESS_CHEAT_SHEET: CheatSoftware = {
  id: 'compress',
  name: '压缩 / 解压',
  description: '常见归档压缩与解压指令',
  icon: <Archive className="h-4 w-4" />,
  color: 'bg-emerald-600',
  sectionColors: ['bg-emerald-600', 'bg-green-600', 'bg-teal-600', 'bg-green-700'],
  sections: [
    {
      title: 'tar',
      items: [
        { command: 'tar -czf out.tar.gz <dir>', description: '压缩为 .tar.gz（gzip）' },
        { command: 'tar -cjf out.tar.bz2 <dir>', description: '压缩为 .tar.bz2（bzip2）' },
        { command: 'tar -cJf out.tar.xz <dir>', description: '压缩为 .tar.xz（xz）' },
        { command: 'tar -xzf file.tar.gz', description: '解压 .tar.gz' },
        { command: 'tar -xjf file.tar.bz2', description: '解压 .tar.bz2' },
        { command: 'tar -xJf file.tar.xz', description: '解压 .tar.xz' },
        { command: 'tar -xzf file.tar.gz -C <dir>', description: '解压到指定目录' },
        { command: 'tar -tf file.tar.gz', description: '查看压缩包内容' },
        { command: 'tar -czf out.tar.gz -T list.txt', description: '按文件列表压缩' },
      ],
    },
    {
      title: 'zip / unzip',
      items: [
        { command: 'zip -r out.zip <dir>', description: '压缩目录' },
        { command: 'zip out.zip f1 f2 f3', description: '压缩多个文件' },
        { command: 'zip -e out.zip <dir>', description: '加密压缩' },
        { command: 'zip -9 -r out.zip <dir>', description: '最大压缩率' },
        { command: 'unzip file.zip', description: '解压到当前目录' },
        { command: 'unzip file.zip -d <dir>', description: '解压到指定目录' },
        { command: 'unzip -l file.zip', description: '查看内容不解压' },
        { command: 'unzip -o file.zip', description: '解压并覆盖同名文件' },
      ],
    },
    {
      title: 'gzip / gunzip',
      items: [
        { command: 'gzip <file>', description: '压缩文件（原文件删除）' },
        { command: 'gzip -k <file>', description: '压缩并保留原文件' },
        { command: 'gzip -9 <file>', description: '最大压缩率' },
        { command: 'gunzip file.gz', description: '解压 .gz 文件' },
        { command: 'gzip -d file.gz', description: '解压（等同 gunzip）' },
        { command: 'zcat file.gz', description: '查看 gz 内容不解压' },
      ],
    },
    {
      title: '7-Zip',
      items: [
        { command: '7z a out.7z <dir>', description: '压缩为 .7z' },
        { command: '7z a -t zip out.zip <dir>', description: '压缩为 .zip' },
        { command: '7z x file.7z', description: '解压并保留目录结构' },
        { command: '7z e file.7z', description: '解压到当前目录（不含结构）' },
        { command: '7z x file.7z -o<dir>', description: '解压到指定目录' },
        { command: '7z l file.7z', description: '列出压缩包内容' },
        { command: '7z t file.7z', description: '测试压缩包完整性' },
      ],
    },
  ],
}

export function CompressCheatSheetPage({ onBack }: { onBack: () => void }): React.ReactElement {
  return <CheatSheetDetailView software={COMPRESS_CHEAT_SHEET} onBack={onBack} />
}
