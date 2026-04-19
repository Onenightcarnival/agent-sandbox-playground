import { useState } from 'react'
import type { MCPServerInfo } from './Playground'
import './InspectPanel.css'

export interface EnvVar {
  key: string
  value: string
}

interface Props {
  envVars: EnvVar[]
  onEnvVarsChange: (vars: EnvVar[]) => void
  systemPrompt: string
  defaultSystemPrompt: string
  onSystemPromptChange: (prompt: string) => void
  mcpServers: MCPServerInfo[]
}

type SectionKey = 'env' | 'prompt' | 'mcp'

export default function InspectPanel({
  envVars,
  onEnvVarsChange,
  systemPrompt,
  defaultSystemPrompt,
  onSystemPromptChange,
  mcpServers,
}: Props) {
  const [open, setOpen] = useState<Record<SectionKey, boolean>>({
    env: true,
    prompt: true,
    mcp: true,
  })

  const toggle = (key: SectionKey) =>
    setOpen(prev => ({ ...prev, [key]: !prev[key] }))

  const addEnvVar = () => onEnvVarsChange([...envVars, { key: '', value: '' }])
  const removeEnvVar = (i: number) =>
    onEnvVarsChange(envVars.filter((_, idx) => idx !== i))
  const updateEnvVar = (i: number, field: 'key' | 'value', value: string) =>
    onEnvVarsChange(envVars.map((v, idx) => (idx === i ? { ...v, [field]: value } : v)))

  const isDirty = systemPrompt !== defaultSystemPrompt

  return (
    <div className="inspect-panel">
      <section className={`inspect-section ${open.env ? 'open' : ''}`}>
        <button className="inspect-header" onClick={() => toggle('env')}>
          <span className="inspect-caret">{open.env ? '▾' : '▸'}</span>
          <span className="inspect-title">Environment Variables</span>
          <span className="inspect-count">{envVars.length}</span>
        </button>
        {open.env && (
          <div className="inspect-body">
            <div className="env-list">
              {envVars.length === 0 && (
                <div className="inspect-empty">No custom variables.</div>
              )}
              {envVars.map((env, i) => (
                <div key={i} className="env-row">
                  <input
                    value={env.key}
                    onChange={e => updateEnvVar(i, 'key', e.target.value)}
                    type="text"
                    placeholder="KEY"
                    className="env-input env-key-input"
                  />
                  <input
                    value={env.value}
                    onChange={e => updateEnvVar(i, 'value', e.target.value)}
                    type="text"
                    placeholder="value"
                    className="env-input env-value-input"
                  />
                  <button className="env-remove" onClick={() => removeEnvVar(i)} title="Remove">×</button>
                </div>
              ))}
            </div>
            <button className="env-add" onClick={addEnvVar}>+ Add Variable</button>
          </div>
        )}
      </section>

      <section className={`inspect-section ${open.prompt ? 'open' : ''}`}>
        <button className="inspect-header" onClick={() => toggle('prompt')}>
          <span className="inspect-caret">{open.prompt ? '▾' : '▸'}</span>
          <span className="inspect-title">System Prompt</span>
          {isDirty && <span className="inspect-badge">modified</span>}
        </button>
        {open.prompt && (
          <div className="inspect-body">
            <textarea
              className="prompt-editor"
              value={systemPrompt}
              onChange={e => onSystemPromptChange(e.target.value)}
              spellCheck={false}
              placeholder="(empty — no user system prompt will be sent)"
            />
            <div className="prompt-footer">
              <span className="prompt-hint">
                Sent as the first <code>system</code> message.
              </span>
              <button
                className="prompt-reset"
                onClick={() => onSystemPromptChange(defaultSystemPrompt)}
                disabled={!isDirty}
              >
                Reset to default
              </button>
            </div>
          </div>
        )}
      </section>

      <section className={`inspect-section ${open.mcp ? 'open' : ''}`}>
        <button className="inspect-header" onClick={() => toggle('mcp')}>
          <span className="inspect-caret">{open.mcp ? '▾' : '▸'}</span>
          <span className="inspect-title">MCP Servers</span>
          <span className="inspect-count">{mcpServers.length}</span>
        </button>
        {open.mcp && (
          <div className="inspect-body">
            {mcpServers.length === 0 && (
              <div className="inspect-empty">Sandbox not ready yet…</div>
            )}
            {mcpServers.map(server => (
              <ServerCard key={server.prefix} server={server} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function ServerCard({ server }: { server: MCPServerInfo }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const toggleTool = (name: string) =>
    setExpanded(prev => ({ ...prev, [name]: !prev[name] }))

  return (
    <div className="mcp-server">
      <div className="mcp-server-head">
        <span className="mcp-prefix">{server.prefix}</span>
        <span className="mcp-name">{server.name}</span>
      </div>
      {server.instructions && (
        <p className="mcp-instructions">{server.instructions}</p>
      )}
      <div className="mcp-tools">
        {server.tools.map(tool => {
          const isOpen = !!expanded[tool.name]
          return (
            <div key={tool.name} className={`mcp-tool ${isOpen ? 'open' : ''}`}>
              <button className="mcp-tool-head" onClick={() => toggleTool(tool.name)}>
                <span className="mcp-tool-caret">{isOpen ? '▾' : '▸'}</span>
                <code className="mcp-tool-name">{server.prefix}__{tool.name}</code>
                {tool.description && (
                  <span className="mcp-tool-desc">{firstLine(tool.description)}</span>
                )}
              </button>
              {isOpen && (
                <pre className="mcp-tool-schema">
                  {JSON.stringify(tool.inputSchema ?? {}, null, 2)}
                </pre>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function firstLine(s: string): string {
  return s.trim().split('\n')[0]
}
