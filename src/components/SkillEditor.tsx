import { useMemo, useState, useEffect } from 'react'
import { marked } from 'marked'
import CodeEditor from './CodeEditor'
import type { Skill } from '@/types'
import './SkillEditor.css'

interface Props {
  skills: Skill[]
  selectedSkillId: string
  selectedFileName: string
  onSelectSkill: (id: string) => void
  onSelectFile: (name: string) => void
  onUpdateFile: (payload: { skillId: string; fileName: string; content: string }) => void
  onAddFile: (skillId: string) => void
  onRemoveFile: (payload: { skillId: string; fileName: string }) => void
}

export default function SkillEditor({
  skills, selectedSkillId, selectedFileName,
  onSelectSkill, onSelectFile, onUpdateFile, onAddFile, onRemoveFile
}: Props) {
  const currentSkill = useMemo(
    () => skills.find(s => s.id === selectedSkillId),
    [skills, selectedSkillId]
  )

  const allFiles = useMemo(() => {
    if (!currentSkill) return []
    const files: { name: string; language: 'python' | 'markdown' }[] = [
      { name: 'SKILL.md', language: 'markdown' }
    ]
    for (const f of currentSkill.files) {
      files.push({ name: f.name, language: 'python' })
    }
    if (currentSkill.requirements) {
      files.push({ name: 'requirements.txt', language: 'markdown' })
    }
    return files
  }, [currentSkill])

  const currentFileContent = useMemo(() => {
    if (!currentSkill) return ''
    if (selectedFileName === 'SKILL.md') return currentSkill.skillMd
    if (selectedFileName === 'requirements.txt') return currentSkill.requirements
    return currentSkill.files.find(f => f.name === selectedFileName)?.content || ''
  }, [currentSkill, selectedFileName])

  const isMarkdown = selectedFileName.endsWith('.md')
  const [previewMode, setPreviewMode] = useState(true)

  const renderedMarkdown = useMemo(() => {
    if (!isMarkdown) return ''
    return marked.parse(currentFileContent) as string
  }, [isMarkdown, currentFileContent])

  const currentLanguage: 'python' | 'markdown' =
    selectedFileName === 'SKILL.md' || selectedFileName === 'requirements.txt'
      ? 'markdown'
      : 'python'

  useEffect(() => {
    if (isMarkdown) setPreviewMode(true)
  }, [selectedFileName, isMarkdown])

  useEffect(() => {
    if (currentSkill && !allFiles.find(f => f.name === selectedFileName)) {
      onSelectFile('SKILL.md')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSkillId])

  const handleContentChange = (content: string) => {
    if (!currentSkill) return
    onUpdateFile({ skillId: currentSkill.id, fileName: selectedFileName, content })
  }

  const handleRemoveFile = (fileName: string) => {
    if (!currentSkill) return
    if (fileName === 'SKILL.md' || fileName === 'requirements.txt') return
    onRemoveFile({ skillId: currentSkill.id, fileName })
  }

  if (skills.length === 0) {
    return (
      <div className="skill-editor">
        <div className="empty-state">Upload a skill .zip to start editing</div>
      </div>
    )
  }

  return (
    <div className="skill-editor">
      <div className="skill-selector">
        <select
          value={selectedSkillId}
          onChange={e => {
            onSelectSkill(e.target.value)
            onSelectFile('SKILL.md')
          }}
        >
          {skills.map(skill => (
            <option key={skill.id} value={skill.id}>{skill.name}</option>
          ))}
        </select>
      </div>

      {currentSkill && (
        <>
          <div className="file-tabs">
            {allFiles.map(file => (
              <button
                key={file.name}
                className={`file-tab ${selectedFileName === file.name ? 'active' : ''}`}
                onClick={() => onSelectFile(file.name)}
              >
                <span className="file-name">{file.name}</span>
                {file.name !== 'SKILL.md' && file.name !== 'requirements.txt' && (
                  <span
                    className="file-close"
                    onClick={(e) => { e.stopPropagation(); handleRemoveFile(file.name) }}
                  >×</span>
                )}
              </button>
            ))}
            <button className="add-file-btn" onClick={() => onAddFile(currentSkill.id)} title="Add Python file">+</button>
            {isMarkdown && (
              <button
                className={`preview-toggle ${previewMode ? 'active' : ''}`}
                onClick={() => setPreviewMode(!previewMode)}
                title={previewMode ? 'Edit' : 'Preview'}
              >
                {previewMode ? 'Edit' : 'Preview'}
              </button>
            )}
          </div>

          {isMarkdown && previewMode ? (
            <div className="markdown-preview" dangerouslySetInnerHTML={{ __html: renderedMarkdown }} />
          ) : (
            <div className="editor-wrapper">
              <CodeEditor
                key={`${selectedSkillId}-${selectedFileName}`}
                value={currentFileContent}
                language={currentLanguage}
                onChange={handleContentChange}
              />
            </div>
          )}
        </>
      )}
    </div>
  )
}
