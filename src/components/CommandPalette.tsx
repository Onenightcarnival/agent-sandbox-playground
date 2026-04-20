import { useEffect, useMemo, useRef, useState } from 'react'
import './CommandPalette.css'

export type PaletteMode = 'file' | 'search' | 'command'

export interface PaletteCommand {
  id: string
  label: string
  hint?: string
  run: () => void
}

export interface PaletteFile {
  path: string
  content: string
}

interface SearchResult {
  path: string
  line: number
  column: number
  snippet: string
  matchStart: number
  matchEnd: number
}

interface Props {
  mode: PaletteMode
  files: PaletteFile[]
  commands: PaletteCommand[]
  onClose: () => void
  onModeChange: (mode: PaletteMode) => void
  onOpenFile: (path: string) => void
  onOpenFileAtLine: (path: string, line: number, column?: number) => void
}

const MODE_PLACEHOLDER: Record<PaletteMode, string> = {
  file: 'Go to file…',
  search: 'Search in files…',
  command: 'Type a command…',
}

const MODE_LABEL: Record<PaletteMode, string> = {
  file: 'Files',
  search: 'Search',
  command: 'Commands',
}

const MODE_HINT: Record<PaletteMode, string> = {
  file: '⌘P',
  search: '⌘⇧F',
  command: '⌘⇧P',
}

const MAX_RESULTS = 200
const SNIPPET_BEFORE = 24
const SNIPPET_LEN = 140

export default function CommandPalette({
  mode,
  files,
  commands,
  onClose,
  onModeChange,
  onOpenFile,
  onOpenFileAtLine,
}: Props) {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setQuery('')
    setActiveIndex(0)
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [mode])

  useEffect(() => { setActiveIndex(0) }, [query])

  const fileResults = useMemo(() => {
    if (mode !== 'file') return []
    const q = query.trim().toLowerCase()
    if (!q) return files.slice(0, MAX_RESULTS)
    return files
      .map(f => {
        const pathLower = f.path.toLowerCase()
        const idx = pathLower.indexOf(q)
        // Prefer matches on the basename: rank basename hits ahead of path hits.
        const basename = f.path.slice(f.path.lastIndexOf('/') + 1).toLowerCase()
        const basenameIdx = basename.indexOf(q)
        if (idx === -1) return null
        return { file: f, score: basenameIdx !== -1 ? basenameIdx : 1000 + idx }
      })
      .filter((x): x is { file: PaletteFile; score: number } => x !== null)
      .sort((a, b) => a.score - b.score)
      .map(x => x.file)
      .slice(0, MAX_RESULTS)
  }, [mode, query, files])

  const searchResults = useMemo<SearchResult[]>(() => {
    if (mode !== 'search') return []
    const q = query.trim()
    if (!q) return []
    const lower = q.toLowerCase()
    const out: SearchResult[] = []
    for (const f of files) {
      const lines = f.content.split('\n')
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        const idx = line.toLowerCase().indexOf(lower)
        if (idx === -1) continue
        const start = Math.max(0, idx - SNIPPET_BEFORE)
        const end = Math.min(line.length, start + SNIPPET_LEN)
        const prefix = start > 0 ? '…' : ''
        const suffix = end < line.length ? '…' : ''
        const snippet = prefix + line.slice(start, end) + suffix
        const matchStart = prefix.length + (idx - start)
        out.push({
          path: f.path,
          line: i + 1,
          column: idx + 1,
          snippet,
          matchStart,
          matchEnd: matchStart + q.length,
        })
        if (out.length >= MAX_RESULTS) return out
      }
    }
    return out
  }, [mode, query, files])

  const commandResults = useMemo(() => {
    if (mode !== 'command') return []
    const q = query.trim().toLowerCase()
    if (!q) return commands
    return commands.filter(c => c.label.toLowerCase().includes(q))
  }, [mode, query, commands])

  const resultCount =
    mode === 'file' ? fileResults.length :
    mode === 'search' ? searchResults.length :
    commandResults.length

  useEffect(() => {
    const row = listRef.current?.children[activeIndex] as HTMLElement | undefined
    row?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  const commit = (index: number = activeIndex) => {
    if (mode === 'file') {
      const pick = fileResults[index]
      if (pick) { onOpenFile(pick.path); onClose() }
    } else if (mode === 'search') {
      const pick = searchResults[index]
      if (pick) { onOpenFileAtLine(pick.path, pick.line, pick.column); onClose() }
    } else {
      const pick = commandResults[index]
      if (pick) { pick.run(); onClose() }
    }
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex(i => Math.min(i + 1, Math.max(0, resultCount - 1)))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex(i => Math.max(i - 1, 0))
      return
    }
    if (e.key === 'Enter') { e.preventDefault(); commit(); return }
  }

  return (
    <div className="palette-overlay" onMouseDown={onClose}>
      <div className="palette" onMouseDown={e => e.stopPropagation()}>
        <div className="palette-modes">
          {(['file', 'search', 'command'] as PaletteMode[]).map(m => (
            <button
              key={m}
              className={`palette-mode ${mode === m ? 'active' : ''}`}
              onClick={() => onModeChange(m)}
            >
              <span>{MODE_LABEL[m]}</span>
              <span className="palette-mode-hint">{MODE_HINT[m]}</span>
            </button>
          ))}
        </div>
        <input
          ref={inputRef}
          className="palette-input"
          placeholder={MODE_PLACEHOLDER[mode]}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          spellCheck={false}
          autoComplete="off"
        />
        <div className="palette-results" ref={listRef}>
          {mode === 'file' && fileResults.map((f, i) => (
            <div
              key={f.path}
              className={`palette-row ${i === activeIndex ? 'active' : ''}`}
              onMouseEnter={() => setActiveIndex(i)}
              onMouseDown={(e) => { e.preventDefault(); commit(i) }}
            >
              <span className="palette-row-main">{f.path}</span>
            </div>
          ))}
          {mode === 'search' && searchResults.map((r, i) => (
            <div
              key={`${r.path}:${r.line}:${r.column}`}
              className={`palette-row palette-row-multi ${i === activeIndex ? 'active' : ''}`}
              onMouseEnter={() => setActiveIndex(i)}
              onMouseDown={(e) => { e.preventDefault(); commit(i) }}
            >
              <div className="palette-row-sub">{r.path}:{r.line}</div>
              <div className="palette-row-main palette-row-snippet">
                {r.snippet.slice(0, r.matchStart)}
                <mark>{r.snippet.slice(r.matchStart, r.matchEnd)}</mark>
                {r.snippet.slice(r.matchEnd)}
              </div>
            </div>
          ))}
          {mode === 'command' && commandResults.map((c, i) => (
            <div
              key={c.id}
              className={`palette-row ${i === activeIndex ? 'active' : ''}`}
              onMouseEnter={() => setActiveIndex(i)}
              onMouseDown={(e) => { e.preventDefault(); commit(i) }}
            >
              <span className="palette-row-main">{c.label}</span>
              {c.hint && <span className="palette-row-hint">{c.hint}</span>}
            </div>
          ))}
          {resultCount === 0 && (
            <div className="palette-empty">
              {mode === 'search' && !query.trim() ? 'Type to search across files…' : 'No matches'}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
