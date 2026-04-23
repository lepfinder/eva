import { useState, useEffect, useRef } from 'react'
import { Loader2, FileCode, Folder, FileText, LayoutGrid, Terminal, ChevronRight, Maximize2, Minimize2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'

interface SkillFile {
    name: string
    path: string
    isDirectory: boolean
}

interface InstalledSkill {
    id: string
    path: string
    manifest: {
        name: string
        description?: string
        version: string
    }
    readme?: string
}

// 递归文件树组件
const FileTreeItem: React.FC<{
    file: SkillFile
    level: number
    activeSkillPath: string
    selectedFilePath: string | null
    onFileClick: (file: SkillFile) => void
}> = ({ file, level, activeSkillPath, selectedFilePath, onFileClick }) => {
    const [isOpen, setIsOpen] = useState(false)
    const [children, setChildren] = useState<SkillFile[]>([])
    const [isLoading, setIsLoading] = useState(false)

    const toggleOpen = async (e: React.MouseEvent) => {
        e.stopPropagation()
        if (file.isDirectory) {
            if (!isOpen && children.length === 0) {
                setIsLoading(true)
                try {
                    const items = await window.api.skills.listFiles(file.path)
                    setChildren(items)
                } catch (error) {
                    console.error('Failed to load sub-files:', error)
                } finally {
                    setIsLoading(false)
                }
            }
            setIsOpen(!isOpen)
        } else {
            onFileClick(file)
        }
    }

    return (
        <div className="select-none">
            <div
                className={cn(
                    "flex items-center gap-3 py-2 pr-4 text-[13px] cursor-pointer transition-all border-r-4 group relative",
                    selectedFilePath === file.path
                        ? "bg-primary/5 text-primary border-primary font-bold"
                        : "border-transparent text-muted-foreground/80 hover:bg-muted/30"
                )}
                onClick={toggleOpen}
                style={{ paddingLeft: `${1.2 + level * 0.8}rem` }}
            >
                {file.isDirectory ? (
                    <div className="flex items-center gap-1.5 shrink-0">
                        <ChevronRight className={cn(
                            "w-3 h-3 transition-transform duration-200 opacity-40 group-hover:opacity-100",
                            isOpen && "rotate-90 opacity-100"
                        )} />
                        <Folder className={cn(
                            "w-4 h-4 text-amber-500/40 transition-colors",
                            isOpen && "text-amber-500/70"
                        )} />
                    </div>
                ) : (
                    <FileCode className="w-4 h-4 shrink-0 opacity-20 group-hover:opacity-50 ml-4.5"
                        style={{ marginLeft: '1.15rem' }} // Offset for lack of chevron
                    />
                )}
                <span className="truncate flex-1 py-0.5">{file.name}</span>
            </div>

            {file.isDirectory && isOpen && (
                <div className="flex flex-col overflow-hidden animate-in slide-in-from-top-1 duration-200">
                    {isLoading ? (
                        <div className="py-2.5 px-12 opacity-30 animate-pulse text-[10px] italic">Loading...</div>
                    ) : (
                        children.length === 0 ? (
                            <div className="py-2.5 px-12 opacity-20 text-[10px] italic">Empty</div>
                        ) : (
                            children.map(child => (
                                <FileTreeItem
                                    key={child.path}
                                    file={child}
                                    level={level + 1}
                                    activeSkillPath={activeSkillPath}
                                    selectedFilePath={selectedFilePath}
                                    onFileClick={onFileClick}
                                />
                            ))
                        )
                    )}
                </div>
            )}
        </div>
    )
}

interface SkillHostProps {
    onOpenStore: () => void
}

export function SkillHostPage({ onOpenStore }: SkillHostProps) {

    const [skills, setSkills] = useState<InstalledSkill[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [activeSkillId, setActiveSkillId] = useState<string | null>(null)
    const [files, setFiles] = useState<SkillFile[]>([])
    const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null)
    const [fileContent, setFileContent] = useState<string | null>(null)
    const [isReadingFile, setIsReadingFile] = useState(false)
    const [previewMode, setPreviewMode] = useState(true)
    const [isFullscreen, setIsFullscreen] = useState(false)

    const [descriptionExpanded, setDescriptionExpanded] = useState(false)
    const [canExpand, setCanExpand] = useState(false)
    const descriptionRef = useRef<HTMLParagraphElement>(null)

    const activeSkill = skills.find(s => s.id === activeSkillId)

    useEffect(() => {
        loadSkills()
        setDescriptionExpanded(false)
    }, [])

    useEffect(() => {
        if (activeSkill) {
            loadFiles(activeSkill.path)
            setSelectedFilePath(null)
            setFileContent(activeSkill.readme || null)
            setPreviewMode(true)
            setDescriptionExpanded(false)
            setCanExpand(false)

        }
    }, [activeSkillId, skills])

    useEffect(() => {
        if (descriptionRef.current && !descriptionExpanded) {
            const hasOverflow = descriptionRef.current.scrollHeight > descriptionRef.current.clientHeight
            setCanExpand(hasOverflow)
        }
    }, [activeSkill, descriptionExpanded])

    const loadSkills = async () => {
        try {
            setIsLoading(true)
            const data = await window.api.skills.list()
            setSkills(data)
            if (data.length > 0 && !activeSkillId) {
                setActiveSkillId(data[0].id)
            }
        } catch (error) {
            console.error('Failed to load skills:', error)
        } finally {
            setIsLoading(false)
        }
    }

    const loadFiles = async (path: string) => {
        try {
            const fileList = await window.api.skills.listFiles(path)
            setFiles(fileList)
        } catch (error) {
            console.error('Failed to load files:', error)
        }
    }

    const handleFileClick = async (file: SkillFile) => {
        if (file.isDirectory) return
        try {
            setIsReadingFile(true)
            setSelectedFilePath(file.path)
            const content = await window.api.skills.readFile(file.path)
            setFileContent(content)
            // 如果是 md 文件则默认预览模式，否则进入原始代码模式
            setPreviewMode(file.path.endsWith('.md'))
        } catch (error) {
            console.error('Failed to read file:', error)
        } finally {
            setIsReadingFile(false)
        }
    }

    const stripFrontmatter = (content: string) => {
        return content.replace(/^---\r?\n[\s\S]*?\r?\n---/, '').trim()
    }

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-full">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        )
    }

    if (skills.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-full space-y-4 text-center p-8">
                <p className="text-muted-foreground font-medium">尚未在 ~/.claude/skills 中发现任何技能</p>
                <p className="text-xs opacity-50">请确保已通过 Claude CLI 正确安装技能</p>
            </div>
        )
    }

    const isMarkdown = !selectedFilePath || selectedFilePath.endsWith('.md')

    return (
        <div className="flex h-full bg-background overflow-hidden text-foreground">
            {/* Leftmost Sidebar: Skill List */}
            {!isFullscreen && (
                <aside className="w-56 border-r flex flex-col bg-muted/10 shrink-0 animate-in fade-in slide-in-from-left-4 duration-300">
                    <div className="p-5 border-b flex items-center gap-2.5 font-black text-[11px] uppercase tracking-[0.2em] opacity-50 shrink-0">
                        <LayoutGrid className="w-3.5 h-3.5" />
                        <span>Skill Library</span>
                    </div>
                    <nav className="flex-1 overflow-y-auto p-2 custom-scrollbar">
                        {skills.map(skill => (
                            <div
                                key={skill.id}
                                onClick={() => setActiveSkillId(skill.id)}
                                className={cn(
                                    "group mb-1 p-3 rounded-xl cursor-pointer transition-all duration-200 border",
                                    activeSkillId === skill.id
                                        ? "bg-primary text-primary-foreground border-primary shadow-lg shadow-primary/20 scale-[1.02]"
                                        : "bg-transparent text-muted-foreground/80 border-transparent hover:bg-muted/50 hover:text-foreground"
                                )}
                            >
                                <div className="flex items-center gap-3">
                                    <div className={cn(
                                        "w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border transition-colors",
                                        activeSkillId === skill.id ? "bg-white/20 border-white/20" : "bg-muted/80 border-border"
                                    )}>
                                        <Terminal className="w-4 h-4" />
                                    </div>
                                    <div className="min-w-0">
                                        <h3 className="text-xs font-bold truncate leading-tight">{skill.manifest.name}</h3>
                                        <p className={cn(
                                            "text-[9px] mt-0.5 font-medium opacity-60",
                                            activeSkillId === skill.id ? "text-white" : "text-muted-foreground"
                                        )}>v{skill.manifest.version}</p>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </nav>
                    <div className="p-4 border-t bg-muted/5 shrink-0">
                        <button
                            onClick={onOpenStore}
                            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-all font-bold text-[11px] uppercase tracking-wider border border-primary/20"
                        >
                            <LayoutGrid className="w-3.5 h-3.5" />
                            <span>Browse Store</span>
                        </button>
                    </div>
                </aside>

            )}

            {/* Right Side: Skill Content Area */}
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                {/* Header: Skill Summary */}
                <header className="px-8 py-6 border-b bg-card/30 flex-shrink-0 z-10 transition-all shadow-sm">
                    <div className="flex flex-col gap-4">
                        <div className="flex items-center gap-4">
                            <h1 className="text-3xl font-black tracking-tighter truncate leading-none">
                                {activeSkill?.manifest.name}
                            </h1>
                            <span className="flex-shrink-0 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-blue-500/10 text-blue-600 border border-blue-500/20 shadow-sm">
                                v{activeSkill?.manifest.version}
                            </span>
                        </div>

                        {/* Subtitle Row */}
                        <div className="flex items-center gap-3 text-[10px] font-mono">
                            <div className="px-2.5 py-1 rounded-lg bg-muted/60 border border-border/30 flex items-center gap-1.5 shadow-inner">
                                <span className="opacity-40 font-bold uppercase shrink-0 px-1 border-r border-border/20">ID</span>
                                <span className="select-all font-semibold tracking-tight opacity-70">{activeSkill?.id}</span>
                            </div>
                            <div className="px-2.5 py-1 rounded-lg bg-muted/40 border border-border/30 flex items-center gap-1.5 max-w-2xl">
                                <span className="opacity-40 uppercase font-bold text-[9px] shrink-0 px-1 border-r border-border/20">Location</span>
                                <span className="opacity-60 truncate font-semibold" title={activeSkill?.path}>{activeSkill?.path}</span>
                            </div>
                        </div>

                        <div className="relative group max-w-4xl">
                            <p
                                ref={descriptionRef}
                                className={cn(
                                    "text-[15px] text-muted-foreground mt-3 italic font-light opacity-80 leading-relaxed transition-all duration-300",
                                    !descriptionExpanded && "line-clamp-2"
                                )}
                            >
                                {activeSkill?.manifest.description || '探索技能的源文件与核心逻辑。'}
                            </p>
                            {canExpand && (
                                <button
                                    onClick={() => setDescriptionExpanded(!descriptionExpanded)}
                                    className="mt-2 text-[10px] font-black uppercase tracking-widest text-primary hover:underline transition-all"
                                >
                                    {descriptionExpanded ? '收起详情 ↑' : '展开全部 ↓'}
                                </button>
                            )}
                        </div>
                    </div>
                </header>

                <main className="flex-1 flex overflow-hidden min-h-0">
                    {/* Left: Sidebar File Tree */}
                    {!isFullscreen && (
                        <aside className="w-64 border-r bg-card/20 flex flex-col flex-shrink-0 animate-in fade-in slide-in-from-left-2 duration-200">
                            <div className="p-4 border-b bg-muted/10 flex items-center gap-2 font-black text-[10px] uppercase tracking-[0.25em] opacity-40">
                                <Folder className="w-3.5 h-3.5" />
                                <span>Project Files</span>
                            </div>
                            <nav className="flex-1 overflow-y-auto py-3 custom-scrollbar">
                                <div
                                    className={cn(
                                        "flex items-center gap-3 px-6 py-3.5 text-[13px] cursor-pointer transition-all border-r-4",
                                        !selectedFilePath ? "bg-primary/5 text-primary border-primary font-bold shadow-sm" : "border-transparent text-muted-foreground/80 hover:bg-muted/30"
                                    )}
                                    onClick={() => {
                                        setSelectedFilePath(null)
                                        setFileContent(activeSkill?.readme || null)
                                        setPreviewMode(true)
                                    }}
                                >
                                    <FileText className="w-4.5 h-4.5 flex-shrink-0 opacity-70" />
                                    <span className="truncate">SKILL.md</span>
                                </div>

                                <div className="my-2 border-t border-border/5 mx-6" />

                                {activeSkill && files.filter(f => f.name !== 'SKILL.md').map(file => (
                                    <FileTreeItem
                                        key={file.path}
                                        file={file}
                                        level={0}
                                        activeSkillPath={activeSkill.path}
                                        selectedFilePath={selectedFilePath}
                                        onFileClick={handleFileClick}
                                    />
                                ))}
                            </nav>
                        </aside>
                    )}

                    {/* Right: Code Editor / Viewer */}
                    <section className="flex-1 flex flex-col min-w-0 bg-background relative shadow-inner">
                        <div className="px-8 py-3.5 border-b bg-muted/10 flex items-center justify-between flex-shrink-0 text-[10px] font-mono text-muted-foreground/60 tracking-tight">
                            <div className="flex items-center gap-3 truncate">
                                <FileText className="w-3.5 h-3.5 opacity-40" />
                                <span className="truncate font-semibold">{selectedFilePath || `SKILL.md`}</span>
                            </div>

                            <div className="flex items-center gap-3">
                                {isMarkdown && (
                                    <div className="flex bg-muted/40 p-1 rounded-xl border shadow-sm scale-90 origin-right transition-all">
                                        <button
                                            className={cn("px-5 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all", previewMode ? "bg-background shadow-md text-primary" : "text-muted-foreground hover:text-foreground")}
                                            onClick={() => setPreviewMode(true)}
                                        >
                                            PREVIEW
                                        </button>
                                        <button
                                            className={cn("px-5 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all", !previewMode ? "bg-background shadow-md text-primary" : "text-muted-foreground hover:text-foreground")}
                                            onClick={() => setPreviewMode(false)}
                                        >
                                            RAW SOURCE
                                        </button>
                                    </div>
                                )}

                                <button
                                    onClick={() => setIsFullscreen(!isFullscreen)}
                                    className="p-2 rounded-lg bg-muted/40 border hover:bg-muted transition-colors"
                                    title={isFullscreen ? "退出全屏" : "全屏显示"}
                                >
                                    {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                                </button>
                            </div>
                        </div>

                        <div className="flex-1 overflow-auto custom-scrollbar">
                            {isReadingFile ? (
                                <div className="flex items-center justify-center h-full text-primary/20">
                                    <Loader2 className="h-12 w-12 animate-spin" />
                                </div>
                            ) : (
                                <div className={cn("min-h-full transition-all duration-300", isMarkdown && previewMode ? "p-16 md:p-24 max-w-5xl mx-auto" : "p-0")}>
                                    {isMarkdown && previewMode ? (
                                        <div className="prose prose-neutral dark:prose-invert max-w-none 
                                            prose-headings:font-black prose-headings:tracking-tight 
                                            prose-h1:text-4xl prose-h1:mb-12 prose-h1:pb-8 prose-h1:border-b
                                            prose-h2:text-2xl prose-h2:mt-20 prose-h2:mb-8
                                            prose-p:text-[17px] prose-p:leading-loose prose-p:text-foreground/80
                                            prose-li:text-foreground/80 prose-li:my-2
                                            prose-code:text-primary prose-code:bg-primary/5 prose-code:px-2 prose-code:py-1 prose-code:rounded prose-code:font-mono prose-code:text-[0.9em] prose-code:before:content-none prose-code:after:content-none
                                            prose-pre:bg-[#0d1117] prose-pre:border prose-pre:border-white/5 prose-pre:shadow-2xl prose-pre:p-8 prose-pre:rounded-2xl
                                            prose-strong:text-foreground prose-strong:font-black
                                            prose-blockquote:border-l-4 prose-blockquote:border-primary/30 prose-blockquote:bg-primary/5 prose-blockquote:py-3 prose-blockquote:px-8 prose-blockquote:rounded-r-xl prose-blockquote:italic
                                            font-sans pb-40">
                                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                                {stripFrontmatter(fileContent || '')}
                                            </ReactMarkdown>
                                        </div>
                                    ) : (
                                        <div className="flex h-full min-h-screen bg-[#0d1117] text-[#e6edf3] font-mono text-[14px] leading-[1.7] select-text cursor-text">
                                            {/* Line Numbers */}
                                            <div className="w-16 flex-shrink-0 bg-black/30 text-stone-600 text-right pr-6 py-10 border-r border-white/5 select-none font-light italic">
                                                {(fileContent || '').split('\n').map((_, i) => (
                                                    <div key={i} className="h-[23.8px]">{i + 1}</div>
                                                ))}
                                            </div>
                                            {/* Code Content */}
                                            <div className="flex-1 py-10 px-12 overflow-x-auto whitespace-pre custom-scrollbar pb-40">
                                                <code>{fileContent}</code>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </section>
                </main>
            </div>
        </div>
    )
}
