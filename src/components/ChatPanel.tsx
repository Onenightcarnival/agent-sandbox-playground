import { useState, useRef, useEffect, useMemo } from 'react'
import type { ChatMessage, Skill } from '@/types'
import './ChatPanel.css'

/** Number of characters shown when a tool result is collapsed. */
const TOOL_PREVIEW_CHARS = 120

/** Max skill suggestions shown in the picker. */
const MAX_SUGGESTIONS = 8

function slugify(name: string): string {
  return name.trim().replace(/\s+/g, '-')
}

function ToolResult({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false)
  const isLong = content.length > TOOL_PREVIEW_CHARS
  const displayed = expanded || !isLong ? content : content.slice(0, TOOL_PREVIEW_CHARS).replace(/\s+$/, '') + '…'
  const firstLine = content.split('\n', 1)[0]
  const lineCount = content.split('\n').length

  return (
    <div className={`tool-result-wrapper ${expanded ? 'expanded' : 'collapsed'}`}>
      {isLong && !expanded && (
        <button
          className="tool-result-toggle"
          onClick={() => setExpanded(true)}
          title={firstLine}
        >
          ▸ Expand tool result ({content.length} chars, {lineCount} lines)
        </button>
      )}
      <code className="tool-result">{displayed}</code>
      {isLong && expanded && (
        <button className="tool-result-toggle" onClick={() => setExpanded(false)}>
          ▾ Collapse
        </button>
      )}
    </div>
  )
}

interface Props {
  messages: ChatMessage[]
  loading: boolean
  streamingContent: string
  skills: Skill[]
  onSend: (message: string) => void
  onStop: () => void
}

interface MenuState {
  /** Index of the triggering `/` character in `input`. */
  startPos: number
  /** Characters typed after the `/` and before the caret. */
  query: string
  /** Highlighted suggestion index. */
  selectedIndex: number
}

export default function ChatPanel({ messages, loading, streamingContent, skills, onSend, onStop }: Props) {
  const [input, setInput] = useState('')
  const [menu, setMenu] = useState<MenuState | null>(null)
  const messagesRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const mirrorRef = useRef<HTMLDivElement>(null)

  // Map of slug → skill for fast chip lookup. Case-sensitive slug.
  const skillBySlug = useMemo(() => {
    const m = new Map<string, Skill>()
    for (const s of skills) m.set(slugify(s.name), s)
    return m
  }, [skills])

  const filteredSkills = useMemo(() => {
    if (!menu) return []
    const q = menu.query.toLowerCase()
    return skills
      .filter(s => s.name.toLowerCase().includes(q))
      .slice(0, MAX_SUGGESTIONS)
  }, [menu, skills])

  useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight
    }
  }, [messages.length, streamingContent])

  // Clamp selectedIndex if the filtered list shrank.
  useEffect(() => {
    if (!menu) return
    if (filteredSkills.length === 0) return
    if (menu.selectedIndex >= filteredSkills.length) {
      setMenu(m => m ? { ...m, selectedIndex: 0 } : null)
    }
  }, [filteredSkills.length, menu])

  /**
   * Scan backwards from the caret to decide whether we are currently typing a
   * `/query` token. The menu opens only when `/` is at the start of input or
   * preceded by whitespace, and the query so far contains only word characters.
   */
  const recomputeMenu = (value: string, caret: number) => {
    let i = caret - 1
    while (i >= 0) {
      const ch = value[i]
      if (/\s/.test(ch)) break
      if (ch === '/') {
        if (i === 0 || /\s/.test(value[i - 1])) {
          const query = value.slice(i + 1, caret)
          if (/^[a-zA-Z0-9_-]*$/.test(query)) {
            setMenu(prev => ({
              startPos: i,
              query,
              selectedIndex: prev?.startPos === i ? prev.selectedIndex : 0,
            }))
            return
          }
        }
        break
      }
      i--
    }
    setMenu(null)
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    setInput(value)
    autoResize()
    recomputeMenu(value, e.target.selectionStart ?? value.length)
  }

  const handleSelectionChange = () => {
    const el = textareaRef.current
    if (!el) return
    recomputeMenu(el.value, el.selectionStart ?? 0)
  }

  const selectSkill = (skill: Skill) => {
    if (!menu) return
    const slug = slugify(skill.name)
    const before = input.slice(0, menu.startPos)
    const afterEnd = menu.startPos + 1 + menu.query.length
    const after = input.slice(afterEnd)
    const insertion = `/${slug} `
    const newValue = before + insertion + after
    const caretPos = menu.startPos + insertion.length
    setInput(newValue)
    setMenu(null)
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(caretPos, caretPos)
      autoResize()
    })
  }

  const handleSend = () => {
    const text = input.trim()
    if (!text || loading) return

    // Collect referenced skill slugs in order of first appearance.
    const refs: string[] = []
    const seen = new Set<string>()
    const tokenRe = /(^|\s)\/([a-zA-Z0-9_-]+)/g
    let match
    while ((match = tokenRe.exec(input)) !== null) {
      const slug = match[2]
      if (skillBySlug.has(slug) && !seen.has(slug)) {
        seen.add(slug)
        refs.push(slug)
      }
    }

    let outgoing = text
    if (refs.length > 0) {
      const names = refs.map(slug => skillBySlug.get(slug)!.name).join(', ')
      outgoing = `[Selected skill(s): ${names}]\n\n${text}`
    }

    onSend(outgoing)
    setInput('')
    setMenu(null)
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }

  const handleKeydown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (menu && filteredSkills.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMenu(m => m ? { ...m, selectedIndex: (m.selectedIndex + 1) % filteredSkills.length } : null)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMenu(m => m ? { ...m, selectedIndex: (m.selectedIndex - 1 + filteredSkills.length) % filteredSkills.length } : null)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        selectSkill(filteredSkills[menu.selectedIndex])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setMenu(null)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const autoResize = () => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    const maxHeight = 6 * 22
    el.style.height = Math.min(el.scrollHeight, maxHeight) + 'px'
  }

  const syncMirrorScroll = () => {
    const ta = textareaRef.current
    const mirror = mirrorRef.current
    if (!ta || !mirror) return
    mirror.scrollTop = ta.scrollTop
  }

  /**
   * Split the input into plain text and skill-chip segments for the mirror
   * overlay. Only slugs that match a loaded skill become chips; unknown tokens
   * render as normal text.
   */
  const mirrorSegments = useMemo(() => {
    const parts: Array<{ text: string; chip: boolean }> = []
    const regex = /(^|\s)\/([a-zA-Z0-9_-]+)/g
    let lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = regex.exec(input)) !== null) {
      const lead = m[1]
      const slug = m[2]
      if (!skillBySlug.has(slug)) continue
      const tokenStart = m.index + lead.length
      const tokenEnd = tokenStart + slug.length + 1 // +1 for '/'
      if (tokenStart > lastIndex) {
        parts.push({ text: input.slice(lastIndex, tokenStart), chip: false })
      }
      parts.push({ text: input.slice(tokenStart, tokenEnd), chip: true })
      lastIndex = tokenEnd
    }
    if (lastIndex < input.length) {
      parts.push({ text: input.slice(lastIndex), chip: false })
    }
    return parts
  }, [input, skillBySlug])

  const hasChips = mirrorSegments.some(p => p.chip)

  return (
    <div className="chat-panel">
      <div ref={messagesRef} className="messages">
        {messages.map(msg => (
          <div key={msg.id} className={`message ${msg.role}`}>
            <div className="message-role">{msg.role}</div>
            <div className="message-content">
              {msg.role === 'tool' ? (
                <ToolResult content={msg.content} />
              ) : (
                msg.content
              )}
            </div>
            {msg.toolCalls && msg.toolCalls.length > 0 && (
              <div className="tool-calls">
                {msg.toolCalls.map(tc => (
                  <div key={tc.id} className="tool-call">
                    <code>{tc.function.name}({tc.function.arguments})</code>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        {streamingContent && (
          <div className="message assistant streaming">
            <div className="message-role">assistant</div>
            <div className="message-content">{streamingContent}</div>
          </div>
        )}
      </div>
      <div className="input-container">
        <div className="input-box">
          <div className={`textarea-wrap ${hasChips ? 'has-chips' : ''}`}>
            <div
              ref={mirrorRef}
              className="highlight-mirror"
              aria-hidden="true"
            >
              {mirrorSegments.map((seg, i) =>
                seg.chip ? (
                  <span key={i} className="skill-chip">{seg.text}</span>
                ) : (
                  <span key={i}>{seg.text}</span>
                )
              )}
              {/* Trailing newline marker so the mirror grows with a blank last line */}
              {'\u200B'}
            </div>
            <textarea
              ref={textareaRef}
              value={input}
              disabled={loading}
              placeholder="Send a message... (type / to insert a skill)"
              rows={1}
              onChange={handleInputChange}
              onKeyDown={handleKeydown}
              onKeyUp={handleSelectionChange}
              onClick={handleSelectionChange}
              onScroll={syncMirrorScroll}
              onBlur={() => setTimeout(() => setMenu(null), 120)}
            />
            {menu && filteredSkills.length > 0 && (
              <div className="skill-menu" role="listbox">
                <div className="skill-menu-hint">Insert skill</div>
                {filteredSkills.map((s, i) => (
                  <button
                    key={s.id}
                    role="option"
                    aria-selected={i === menu.selectedIndex}
                    className={`skill-menu-item ${i === menu.selectedIndex ? 'active' : ''}`}
                    onMouseDown={e => { e.preventDefault(); selectSkill(s) }}
                    onMouseEnter={() => setMenu(m => m ? { ...m, selectedIndex: i } : null)}
                  >
                    <span className="skill-menu-name">/{slugify(s.name)}</span>
                    {s.description && (
                      <span className="skill-menu-desc">{s.description}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
          {loading ? (
            <button className="stop-btn" onClick={onStop}>Stop</button>
          ) : (
            <button className="send-icon-btn" disabled={!input.trim()} onClick={handleSend}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 2L11 13" />
                <path d="M22 2L15 22L11 13L2 9L22 2Z" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
