import { useState, useRef } from 'react'
import JSZip from 'jszip'
import type { Skill, SkillFile, SkillValidationIssue, SkillValidationResult } from '@/types'
import './SkillManager.css'

interface Props {
  skills: Skill[]
  onAdd: (skill: Skill) => void
  onRemove: (id: string) => void
  onSelect: (id: string) => void
}

const NAME_KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/
const DESC_MIN = 20
const DESC_MAX = 500

function parseFrontmatter(md: string): { raw: string | null; name: string | null; description: string | null } {
  const match = md.match(/^---\s*\n([\s\S]*?)\n---/)
  if (!match) return { raw: null, name: null, description: null }
  const yaml = match[1]
  const name = yaml.match(/^name:\s*(.+)$/m)?.[1]?.trim() ?? null
  const description = yaml.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? null
  return { raw: yaml, name: name || null, description: description || null }
}

async function validateZip(file: File): Promise<SkillValidationResult> {
  const errors: SkillValidationIssue[] = []
  const warnings: SkillValidationIssue[] = []

  if (!file.name.toLowerCase().endsWith('.zip')) {
    errors.push({ level: 'error', message: `Not a .zip file: ${file.name}` })
    return { skill: null, errors, warnings, fileName: file.name }
  }

  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(file)
  } catch (e: any) {
    errors.push({ level: 'error', message: `Failed to read zip: ${e.message}` })
    return { skill: null, errors, warnings, fileName: file.name }
  }

  // Resolve top-level prefix if the zip wraps everything in a single dir
  let prefix = ''
  const dirs = Object.keys(zip.files).filter(e => e.endsWith('/'))
  const topDirs = dirs.filter(d => d.split('/').filter(Boolean).length === 1)
  if (topDirs.length === 1) prefix = topDirs[0]

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
    errors.push({ level: 'error', message: 'SKILL.md is missing (required at the root of the skill)' })
  }
  if (pyFiles.length === 0) {
    errors.push({ level: 'error', message: 'No .py files found — a skill needs at least one Python module' })
  }

  // Frontmatter checks (only if SKILL.md exists)
  let name = 'Unnamed Skill'
  let description = ''

  if (skillMd) {
    const fm = parseFrontmatter(skillMd)
    if (fm.raw === null) {
      errors.push({ level: 'error', message: 'SKILL.md is missing YAML frontmatter (--- ... --- block at the top)' })
    } else {
      if (!fm.name) {
        errors.push({ level: 'error', message: 'Frontmatter is missing `name:` field' })
      } else {
        name = fm.name
        if (!NAME_KEBAB.test(fm.name)) {
          warnings.push({
            level: 'warning',
            message: `name "${fm.name}" is not kebab-case (lowercase letters/digits, hyphen-separated). Models may trigger it less reliably.`
          })
        }
      }
      if (!fm.description) {
        errors.push({ level: 'error', message: 'Frontmatter is missing `description:` field (the LLM uses this to decide when to trigger the skill)' })
      } else {
        description = fm.description
        if (fm.description.length < DESC_MIN) {
          warnings.push({
            level: 'warning',
            message: `description is very short (${fm.description.length} chars). Include what the skill does and when to use it so the LLM can trigger it correctly.`
          })
        } else if (fm.description.length > DESC_MAX) {
          warnings.push({
            level: 'warning',
            message: `description is long (${fm.description.length} chars). Long descriptions clutter the system prompt — keep it concise.`
          })
        }
      }
    }
  }

  if (errors.length > 0) {
    return { skill: null, errors, warnings, fileName: file.name }
  }

  const skill: Skill = {
    id: `skill_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name,
    description,
    skillMd,
    files: pyFiles,
    requirements
  }
  return { skill, errors, warnings, fileName: file.name }
}

export default function SkillManager({ skills, onAdd, onRemove, onSelect }: Props) {
  const [dragging, setDragging] = useState(false)
  const [results, setResults] = useState<SkillValidationResult[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFiles = async (files: FileList | File[]) => {
    const validated: SkillValidationResult[] = []
    for (const file of Array.from(files)) {
      const result = await validateZip(file)
      validated.push(result)
      if (result.skill && result.errors.length === 0) {
        onAdd(result.skill)
      }
    }
    setResults(validated)
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

  const dismissResults = () => setResults([])

  const hasIssues = results.some(r => r.errors.length > 0 || r.warnings.length > 0)

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

      {hasIssues && (
        <div className="validation-panel">
          <div className="validation-header">
            <span>Skill Validation</span>
            <button className="validation-dismiss" onClick={dismissResults} title="Dismiss">×</button>
          </div>
          {results.map((r, i) => (
            (r.errors.length > 0 || r.warnings.length > 0) && (
              <div key={i} className="validation-result">
                <div className="validation-filename">
                  <span className={`validation-status ${r.errors.length > 0 ? 'failed' : 'accepted'}`}>
                    {r.errors.length > 0 ? '✗ Rejected' : '✓ Loaded with warnings'}
                  </span>
                  <span className="validation-file">{r.fileName}</span>
                </div>
                {r.errors.map((issue, j) => (
                  <div key={`e${j}`} className="validation-issue error">
                    <span className="issue-label">error</span>
                    <span className="issue-text">{issue.message}</span>
                  </div>
                ))}
                {r.warnings.map((issue, j) => (
                  <div key={`w${j}`} className="validation-issue warning">
                    <span className="issue-label">warn</span>
                    <span className="issue-text">{issue.message}</span>
                  </div>
                ))}
              </div>
            )
          ))}
        </div>
      )}

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
