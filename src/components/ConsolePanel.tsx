import { useRef, useEffect, useState } from 'react'
import type { ConsoleEntry } from '@/types'
import type { PyodideSandbox } from '@/sandbox/sandbox'
import WorkspaceTree from './WorkspaceTree'
import './ConsolePanel.css'

interface Props {
  entries: ConsoleEntry[]
  onClear: () => void
  onCollapse: () => void
  sandbox: PyodideSandbox | null
  sandboxReady: boolean
  workspaceRefreshKey: number
}

type Tab = 'logs' | 'workspace'

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour12: false })
}

export default function ConsolePanel({
  entries,
  onClear,
  onCollapse,
  sandbox,
  sandboxReady,
  workspaceRefreshKey,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [tab, setTab] = useState<Tab>('logs')

  useEffect(() => {
    if (tab === 'logs' && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [entries.length, tab])

  return (
    <div className="console-panel">
      <div className="console-header">
        <div className="console-tabs" role="tablist" aria-label="Console">
          <button
            role="tab"
            aria-selected={tab === 'logs'}
            className={`console-tab ${tab === 'logs' ? 'active' : ''}`}
            onClick={() => setTab('logs')}
          >
            Logs
          </button>
          <button
            role="tab"
            aria-selected={tab === 'workspace'}
            className={`console-tab ${tab === 'workspace' ? 'active' : ''}`}
            onClick={() => setTab('workspace')}
          >
            Workspace
          </button>
        </div>
        <div className="console-header-actions">
          {tab === 'logs' && (
            <button className="clear-btn" onClick={onClear}>Clear</button>
          )}
          <button className="collapse-btn" onClick={onCollapse} title="Collapse">▶</button>
        </div>
      </div>
      {tab === 'logs' ? (
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
      ) : (
        <WorkspaceTree
          sandbox={sandbox}
          sandboxReady={sandboxReady}
          refreshKey={workspaceRefreshKey}
        />
      )}
    </div>
  )
}
