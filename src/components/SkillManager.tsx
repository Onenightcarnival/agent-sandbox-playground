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

// Aligned with the open Agent Skills spec (agentskills.io) as enforced by
// OpenAI's `quick_validate.py` in github.com/openai/skills:
//   - SKILL.md filename is case-sensitive.
//   - name: ^[a-z0-9-]+$, ≤64 chars, no leading/trailing/consecutive hyphens.
//   - description: non-empty, ≤1024 chars, no `<` or `>` (no XML-style tags).
//   - Allowed frontmatter keys: name, description, license, allowed-tools, metadata.
const NAME_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/
const NAME_MAX = 64
const DESC_MAX = 1024
const ALLOWED_FRONTMATTER_KEYS = new Set([
  'name', 'description', 'license', 'allowed-tools', 'metadata',
])

function parseFrontmatter(md: string): {
  raw: string | null
  name: string | null
  description: string | null
  keys: string[]
} {
  const match = md.match(/^---\s*\n([\s\S]*?)\n---/)
  if (!match) return { raw: null, name: null, description: null, keys: [] }
  const yaml = match[1]
  const name = yaml.match(/^name:\s*(.+)$/m)?.[1]?.trim() ?? null
  const description = yaml.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? null
  // Top-level keys only (no indentation). Good enough for the spec's flat schema.
  const keys = Array.from(yaml.matchAll(/^([A-Za-z0-9_-]+):/gm)).map(m => m[1])
  return { raw: yaml, name: name || null, description: description || null, keys }
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
  let skillMdFileName: string | null = null
  const skillFiles: SkillFile[] = []
  let requirements = ''

  // Accepted text-like extensions for skill files. Everything else (binaries,
  // compiled bytecode, editor junk) is ignored.
  const TEXT_EXTS = /\.(py|json|ya?ml|toml|ini|cfg|md|txt|csv|tsv|xml|sql|sh|env)$/i

  for (const [path, zipEntry] of Object.entries(zip.files)) {
    if (zipEntry.dir) continue
    const relativePath = prefix ? path.replace(prefix, '') : path
    if (!relativePath) continue
    // Skip common junk
    if (relativePath.includes('__pycache__/') || relativePath.endsWith('.DS_Store')) continue

    const fileName = relativePath.split('/').pop() || relativePath
    const atRoot = !relativePath.includes('/')

    // SKILL.md must live at the skill root and use exact uppercase (spec requirement).
    if (atRoot && fileName.toLowerCase() === 'skill.md') {
      skillMd = await zipEntry.async('string')
      skillMdFileName = fileName
    } else if (atRoot && fileName === 'requirements.txt') {
      requirements = await zipEntry.async('string')
    } else if (TEXT_EXTS.test(fileName)) {
      skillFiles.push({ name: relativePath, content: await zipEntry.async('string') })
    }
  }

  if (!skillMd) {
    errors.push({ level: 'error', message: 'SKILL.md is missing at the skill root (required by the Agent Skills spec)' })
  } else if (skillMdFileName && skillMdFileName !== 'SKILL.md') {
    errors.push({
      level: 'error',
      message: `SKILL.md filename must be uppercase (found "${skillMdFileName}"). The spec is case-sensitive.`,
    })
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
        if (fm.name.length > NAME_MAX) {
          errors.push({
            level: 'error',
            message: `name "${fm.name}" exceeds ${NAME_MAX} chars (${fm.name.length}).`,
          })
        }
        if (!NAME_REGEX.test(fm.name)) {
          errors.push({
            level: 'error',
            message: `name "${fm.name}" is not valid. Must match /^[a-z0-9-]+$/ with no leading/trailing/consecutive hyphens.`,
          })
        }
      }
      if (!fm.description) {
        errors.push({ level: 'error', message: 'Frontmatter is missing `description:` field (the LLM uses this to decide when to trigger the skill)' })
      } else {
        description = fm.description
        if (fm.description.length > DESC_MAX) {
          errors.push({
            level: 'error',
            message: `description exceeds ${DESC_MAX} chars (${fm.description.length}).`,
          })
        }
        if (/[<>]/.test(fm.description)) {
          errors.push({
            level: 'error',
            message: 'description must not contain `<` or `>` (spec forbids XML-style tags).',
          })
        }
      }
      // Unknown frontmatter keys: spec only sanctions name/description/license/allowed-tools/metadata.
      const unknown = fm.keys.filter(k => !ALLOWED_FRONTMATTER_KEYS.has(k))
      if (unknown.length > 0) {
        warnings.push({
          level: 'warning',
          message: `Unknown frontmatter key(s): ${unknown.join(', ')}. Spec allows only: ${[...ALLOWED_FRONTMATTER_KEYS].join(', ')}.`,
        })
      }
    }
  }

  // Top-level folder name in the zip should match the skill name (OpenAI convention).
  if (skillMd && name !== 'Unnamed Skill' && prefix) {
    const folder = prefix.replace(/\/$/, '')
    if (folder !== name) {
      errors.push({
        level: 'error',
        message: `Top-level folder "${folder}" does not match frontmatter name "${name}". The spec requires them to match.`,
      })
    }
  }

  // Convention: OpenAI's official skills place all Python under `scripts/`.
  // Warn (don't fail) on any .py at the skill root.
  const rootPy = skillFiles.filter(f => f.name.endsWith('.py') && !f.name.includes('/'))
  if (rootPy.length > 0) {
    warnings.push({
      level: 'warning',
      message: `Python file(s) at skill root: ${rootPy.map(f => f.name).join(', ')}. OpenAI convention places code under scripts/.`,
    })
  }

  if (errors.length > 0) {
    return { skill: null, errors, warnings, fileName: file.name }
  }

  const skill: Skill = {
    id: `skill_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name,
    description,
    skillMd,
    files: skillFiles,
    requirements
  }
  return { skill, errors, warnings, fileName: file.name }
}

async function exportSkillAsZip(skill: Skill): Promise<Blob> {
  const zip = new JSZip()
  const root = zip.folder(skill.name)
  if (!root) throw new Error('Failed to create zip root folder')
  root.file('SKILL.md', skill.skillMd)
  if (skill.requirements) {
    root.file('requirements.txt', skill.requirements)
  }
  for (const f of skill.files) {
    root.file(f.name, f.content)
  }
  return zip.generateAsync({ type: 'blob' })
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
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
              <div className="skill-actions">
                <button
                  className="download-btn"
                  onClick={async (e) => {
                    e.stopPropagation()
                    try {
                      const blob = await exportSkillAsZip(skill)
                      triggerDownload(blob, `${skill.name}.zip`)
                    } catch (err) {
                      console.error('Failed to export skill', err)
                    }
                  }}
                  title="Download skill as .zip"
                  aria-label="Download skill"
                >↓</button>
                <button
                  className="remove-btn"
                  onClick={(e) => { e.stopPropagation(); onRemove(skill.id) }}
                  title="Remove skill"
                >×</button>
              </div>
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
