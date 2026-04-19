import { useMemo, useState, useEffect, useCallback } from 'react'
import { marked } from 'marked'
import CodeEditor from './CodeEditor'
import type { Skill } from '@/types'
import './SkillEditor.css'

interface Props {
  skills: Skill[]
  selectedSkillId: string
  openFiles: string[]
  activeFileName: string | null
  onSelectSkill: (id: string) => void
  onOpenFile: (name: string) => void
  onCloseFile: (name: string) => void
  onUpdateFile: (payload: { skillId: string; fileName: string; content: string }) => void
  onAddFile: (skillId: string) => void
  onDeleteFile: (payload: { skillId: string; fileName: string }) => void
}

const SYSTEM_FILES = new Set(['SKILL.md', 'requirements.txt'])

interface FlatFile {
  name: string
  language: 'python' | 'markdown'
}

interface TreeNode {
  name: string
  path: string
  type: 'file' | 'dir'
  children?: TreeNode[]
}

function buildTree(files: FlatFile[]): TreeNode[] {
  const root: TreeNode[] = []
  const dirIndex = new Map<string, TreeNode>()
  for (const f of files) {
    const parts = f.name.split('/')
    let level = root
    let path = ''
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      path = path ? `${path}/${part}` : part
      if (i === parts.length - 1) {
        level.push({ name: part, path: f.name, type: 'file' })
      } else {
        let dir = dirIndex.get(path)
        if (!dir) {
          dir = { name: part, path, type: 'dir', children: [] }
          dirIndex.set(path, dir)
          level.push(dir)
        }
        level = dir.children!
      }
    }
  }
  const sort = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => a.type !== b.type ? (a.type === 'dir' ? -1 : 1) : a.name.localeCompare(b.name))
    for (const n of nodes) if (n.children) sort(n.children)
  }
  sort(root)
  return root
}

interface TreeRowProps {
  node: TreeNode
  depth: number
  expanded: Set<string>
  activeFileName: string | null
  onToggleDir: (path: string) => void
  onOpenFile: (name: string) => void
  onDeleteFile: (name: string) => void
}

function TreeRow({ node, depth, expanded, activeFileName, onToggleDir, onOpenFile, onDeleteFile }: TreeRowProps) {
  if (node.type === 'dir') {
    const isOpen = expanded.has(node.path)
    return (
      <>
        <div
          className="tree-row tree-dir"
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
          onClick={() => onToggleDir(node.path)}
        >
          <span className="tree-caret">{isOpen ? '▾' : '▸'}</span>
          <span className="tree-icon">📁</span>
          <span className="tree-name">{node.name}</span>
        </div>
        {isOpen && node.children?.map(child => (
          <TreeRow
            key={child.path}
            node={child}
            depth={depth + 1}
            expanded={expanded}
            activeFileName={activeFileName}
            onToggleDir={onToggleDir}
            onOpenFile={onOpenFile}
            onDeleteFile={onDeleteFile}
          />
        ))}
      </>
    )
  }
  const isActive = activeFileName === node.path
  const isSystem = SYSTEM_FILES.has(node.path)
  return (
    <div
      className={`tree-row tree-file ${isActive ? 'active' : ''}`}
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
      onClick={() => onOpenFile(node.path)}
    >
      <span className="tree-caret" />
      <span className="tree-icon">📄</span>
      <span className="tree-name">{node.name}</span>
      {!isSystem && (
        <button
          className="tree-delete"
          onClick={(e) => {
            e.stopPropagation()
            if (confirm(`Delete ${node.path}? This removes the file from the skill.`)) {
              onDeleteFile(node.path)
            }
          }}
          title="Delete file"
        >🗑</button>
      )}
    </div>
  )
}

function languageFor(name: string): 'python' | 'markdown' {
  return name.endsWith('.md') || name === 'requirements.txt' ? 'markdown' : 'python'
}

export default function SkillEditor({
  skills, selectedSkillId, openFiles, activeFileName,
  onSelectSkill, onOpenFile, onCloseFile, onUpdateFile, onAddFile, onDeleteFile
}: Props) {
  const currentSkill = useMemo(
    () => skills.find(s => s.id === selectedSkillId),
    [skills, selectedSkillId]
  )

  const allFiles = useMemo<FlatFile[]>(() => {
    if (!currentSkill) return []
    const files: FlatFile[] = [{ name: 'SKILL.md', language: 'markdown' }]
    for (const f of currentSkill.files) {
      files.push({ name: f.name, language: languageFor(f.name) })
    }
    if (currentSkill.requirements) {
      files.push({ name: 'requirements.txt', language: 'markdown' })
    }
    return files
  }, [currentSkill])

  const tree = useMemo(() => buildTree(allFiles), [allFiles])

  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  // Auto-expand every directory whenever the file set changes, so users see
  // their files by default. Users can still collapse manually; the set is
  // recomputed only when the skill's directory shape changes.
  const allDirs = useMemo(() => {
    const dirs: string[] = []
    const walk = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        if (n.type === 'dir') { dirs.push(n.path); if (n.children) walk(n.children) }
      }
    }
    walk(tree)
    return dirs
  }, [tree])

  useEffect(() => {
    setExpanded(new Set(allDirs))
  }, [allDirs.join('|')]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleDir = useCallback((path: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  const currentFileContent = useMemo(() => {
    if (!currentSkill || !activeFileName) return ''
    if (activeFileName === 'SKILL.md') return currentSkill.skillMd
    if (activeFileName === 'requirements.txt') return currentSkill.requirements
    return currentSkill.files.find(f => f.name === activeFileName)?.content || ''
  }, [currentSkill, activeFileName])

  const isMarkdown = activeFileName?.endsWith('.md') ?? false
  const [previewMode, setPreviewMode] = useState(true)

  const renderedMarkdown = useMemo(() => {
    if (!isMarkdown) return ''
    return marked.parse(currentFileContent) as string
  }, [isMarkdown, currentFileContent])

  useEffect(() => {
    if (isMarkdown) setPreviewMode(true)
  }, [activeFileName, isMarkdown])

  const handleContentChange = (content: string) => {
    if (!currentSkill || !activeFileName) return
    onUpdateFile({ skillId: currentSkill.id, fileName: activeFileName, content })
  }

  const handleDelete = useCallback((name: string) => {
    if (!currentSkill) return
    onDeleteFile({ skillId: currentSkill.id, fileName: name })
  }, [currentSkill, onDeleteFile])

  if (skills.length === 0) {
    return (
      <div className="skill-editor">
        <div className="empty-state">Upload a skill .zip to start editing</div>
      </div>
    )
  }

  const currentLanguage: 'python' | 'markdown' =
    activeFileName ? languageFor(activeFileName) : 'python'

  return (
    <div className="skill-editor">
      <div className="skill-selector">
        <select
          value={selectedSkillId}
          onChange={e => onSelectSkill(e.target.value)}
        >
          {skills.map(skill => (
            <option key={skill.id} value={skill.id}>{skill.name}</option>
          ))}
        </select>
      </div>

      {currentSkill && (
        <div className="editor-body">
          <aside className="tree-pane">
            <div className="tree-toolbar">
              <span className="tree-title">Files</span>
              <button
                className="tree-add"
                onClick={() => onAddFile(currentSkill.id)}
                title="Add new Python file under scripts/"
              >+</button>
            </div>
            <div className="tree-scroll">
              {tree.map(node => (
                <TreeRow
                  key={node.path}
                  node={node}
                  depth={0}
                  expanded={expanded}
                  activeFileName={activeFileName}
                  onToggleDir={toggleDir}
                  onOpenFile={onOpenFile}
                  onDeleteFile={handleDelete}
                />
              ))}
            </div>
          </aside>
          <section className="editor-pane">
            <div className="file-tabs">
              {openFiles.length === 0 ? (
                <div className="tabs-empty">No files open — click a file in the tree.</div>
              ) : openFiles.map(name => (
                <button
                  key={name}
                  className={`file-tab ${activeFileName === name ? 'active' : ''}`}
                  onClick={() => onOpenFile(name)}
                >
                  <span className="file-name">{name}</span>
                  <span
                    className="file-close"
                    onClick={(e) => { e.stopPropagation(); onCloseFile(name) }}
                  >×</span>
                </button>
              ))}
              {isMarkdown && activeFileName && (
                <button
                  className={`preview-toggle ${previewMode ? 'active' : ''}`}
                  onClick={() => setPreviewMode(!previewMode)}
                  title={previewMode ? 'Edit' : 'Preview'}
                >
                  {previewMode ? 'Edit' : 'Preview'}
                </button>
              )}
            </div>

            {activeFileName ? (
              isMarkdown && previewMode ? (
                <div className="markdown-preview" dangerouslySetInnerHTML={{ __html: renderedMarkdown }} />
              ) : (
                <div className="editor-wrapper">
                  <CodeEditor
                    key={`${selectedSkillId}-${activeFileName}`}
                    value={currentFileContent}
                    language={currentLanguage}
                    onChange={handleContentChange}
                  />
                </div>
              )
            ) : (
              <div className="editor-empty">Select a file from the tree to edit.</div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
