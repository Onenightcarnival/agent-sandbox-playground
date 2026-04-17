import { useState, useRef } from 'react'
import JSZip from 'jszip'
import type { Skill, SkillFile } from '@/types'
import './SkillManager.css'

interface Props {
  skills: Skill[]
  onAdd: (skill: Skill) => void
  onRemove: (id: string) => void
  onSelect: (id: string) => void
}

function parseFrontmatter(md: string): { name: string; description: string } {
  const match = md.match(/^---\s*\n([\s\S]*?)\n---/)
  if (!match) return { name: 'Unnamed Skill', description: '' }
  const yaml = match[1]
  const name = yaml.match(/^name:\s*(.+)$/m)?.[1]?.trim() || 'Unnamed Skill'
  const description = yaml.match(/^description:\s*(.+)$/m)?.[1]?.trim() || ''
  return { name, description }
}

async function parseZip(file: File): Promise<Skill | null> {
  try {
    const zip = await JSZip.loadAsync(file)
    const entries = Object.keys(zip.files)

    let prefix = ''
    const dirs = entries.filter(e => e.endsWith('/'))
    if (dirs.length > 0) {
      const topDirs = dirs.filter(d => d.split('/').filter(Boolean).length === 1)
      if (topDirs.length === 1) {
        prefix = topDirs[0]
      }
    }

    let skillMd = ''
    const pyFiles: SkillFile[] = []
    let requirements = ''

    for (const [path, zipEntry] of Object.entries(zip.files)) {
      if (zipEntry.dir) continue
      const relativePath = prefix ? path.replace(prefix, '') : path
      if (!relativePath) continue

      const content = await zipEntry.async('string')
      const fileName = relativePath.split('/').pop() || relativePath

      if (fileName.toLowerCase() === 'skill.md') {
        skillMd = content
      } else if (fileName === 'requirements.txt') {
        requirements = content
      } else if (fileName.endsWith('.py')) {
        pyFiles.push({ name: relativePath, content })
      }
    }

    if (!skillMd) {
      alert(`No SKILL.md found in ${file.name}`)
      return null
    }

    const { name, description } = parseFrontmatter(skillMd)

    return {
      id: `skill_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name,
      description,
      skillMd,
      files: pyFiles,
      requirements
    }
  } catch (e: any) {
    alert(`Failed to parse ${file.name}: ${e.message}`)
    return null
  }
}

export default function SkillManager({ skills, onAdd, onRemove, onSelect }: Props) {
  const [dragging, setDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFiles = async (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      if (!file.name.endsWith('.zip')) {
        alert(`${file.name} is not a zip file`)
        continue
      }
      const skill = await parseZip(file)
      if (skill) onAdd(skill)
    }
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    if (e.dataTransfer?.files) handleFiles(e.dataTransfer.files)
  }

  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) handleFiles(e.target.files)
    e.target.value = ''
  }

  return (
    <div className="skill-manager">
      <div
        className={`upload-zone ${dragging ? 'dragging' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".zip"
          multiple
          hidden
          onChange={onFileInput}
        />
        <div className="upload-text">
          <span className="upload-icon">+</span>
          <span>Drop skill .zip files here or click to upload</span>
        </div>
      </div>

      {skills.length > 0 ? (
        <div className="skill-list">
          {skills.map(skill => (
            <div key={skill.id} className="skill-item" onClick={() => onSelect(skill.id)}>
              <div className="skill-info">
                <div className="skill-name">{skill.name}</div>
                <div className="skill-desc">{skill.description || 'No description'}</div>
                <div className="skill-meta">
                  {skill.files.length} file{skill.files.length !== 1 ? 's' : ''}
                  {skill.requirements && <span> · has requirements.txt</span>}
                </div>
              </div>
              <button
                className="remove-btn"
                onClick={(e) => { e.stopPropagation(); onRemove(skill.id) }}
                title="Remove skill"
              >×</button>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          No skills loaded. Upload a .zip file to get started.
        </div>
      )}
    </div>
  )
}
