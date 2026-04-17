import { useState, useRef, useEffect } from 'react'
import type { ChatMessage } from '@/types'
import './ChatPanel.css'

interface Props {
  messages: ChatMessage[]
  loading: boolean
  streamingContent: string
  onSend: (message: string) => void
  onStop: () => void
}

export default function ChatPanel({ messages, loading, streamingContent, onSend, onStop }: Props) {
  const [input, setInput] = useState('')
  const messagesRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight
    }
  }, [messages.length, streamingContent])

  const handleSend = () => {
    const text = input.trim()
    if (!text || loading) return
    onSend(text)
    setInput('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }

  const handleKeydown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
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

  return (
    <div className="chat-panel">
      <div ref={messagesRef} className="messages">
        {messages.map(msg => (
          <div key={msg.id} className={`message ${msg.role}`}>
            <div className="message-role">{msg.role}</div>
            <div className="message-content">
              {msg.role === 'tool' ? (
                <code className="tool-result">{msg.content}</code>
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
          <textarea
            ref={textareaRef}
            value={input}
            disabled={loading}
            placeholder="Send a message..."
            rows={1}
            onChange={e => { setInput(e.target.value); autoResize() }}
            onKeyDown={handleKeydown}
          />
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
