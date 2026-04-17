import { useRef, useEffect } from 'react'
import type { ConsoleEntry } from '@/types'
import './ConsolePanel.css'

interface Props {
  entries: ConsoleEntry[]
  onClear: () => void
  onCollapse: () => void
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour12: false })
}

export default function ConsolePanel({ entries, onClear, onCollapse }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [entries.length])

  return (
    <div className="console-panel">
      <div className="console-header">
        <span>Console</span>
        <div className="console-header-actions">
          <button className="clear-btn" onClick={onClear}>Clear</button>
          <button className="collapse-btn" onClick={onCollapse} title="Collapse">▶</button>
        </div>
      </div>
      <div ref={containerRef} className="console-entries">
        {entries.length === 0 ? (
          <div className="empty">No output yet</div>
        ) : (
          entries.map((entry, i) => (
            <div key={i} className={`entry ${entry.type}`}>
              <span className="time">{formatTime(entry.timestamp)}</span>
              <span className="tag">{entry.type}</span>
              <span className="msg">{entry.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
