import { useState, useEffect, useMemo } from 'react'
import type { LLMConfig, ToolMode } from '@/types'
import './ConfigPanel.css'

interface Props {
  onConfigChange: (config: LLMConfig) => void
}

const STORAGE_KEY = 'agent-sandbox-config'

export default function ConfigPanel({ onConfigChange }: Props) {
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [modelId, setModelId] = useState('')
  const [toolMode, setToolMode] = useState<ToolMode>('function_call')
  const [collapsed, setCollapsed] = useState(true)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    // Restore from localStorage if present; otherwise fall back to VITE_* env
    // (loaded from .env.local during dev build). Env provides the dev default;
    // anything the user types in the UI thereafter overrides via localStorage.
    const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {}
    let hydratedFromStorage = false
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const config = JSON.parse(saved)
        setBaseUrl(config.baseUrl || '')
        setApiKey(config.apiKey || '')
        setModelId(config.modelId || '')
        if (config.toolMode === 'function_call' || config.toolMode === 'prompt') {
          setToolMode(config.toolMode)
        }
        hydratedFromStorage = true
      }
    } catch {}
    if (!hydratedFromStorage) {
      if (env.VITE_OPENAI_BASE_URL) setBaseUrl(env.VITE_OPENAI_BASE_URL)
      if (env.VITE_OPENAI_API_KEY) setApiKey(env.VITE_OPENAI_API_KEY)
      if (env.VITE_OPENAI_MODEL_ID) setModelId(env.VITE_OPENAI_MODEL_ID)
    }
    setHydrated(true)
  }, [])

  useEffect(() => {
    if (!hydrated) return
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ baseUrl, apiKey, modelId, toolMode }))
    onConfigChange({ baseUrl, apiKey, modelId, toolMode })
  }, [baseUrl, apiKey, modelId, toolMode, hydrated, onConfigChange])

  const hasConfig = !!(baseUrl && apiKey && modelId)

  const configSummary = useMemo(() => {
    const model = modelId || 'No model'
    const key = apiKey ? `sk-...${apiKey.slice(-3)}` : 'No key'
    let domain = 'No URL'
    try {
      domain = new URL(baseUrl).hostname
    } catch {}
    const modeLabel = toolMode === 'function_call' ? 'FnCall' : 'Prompt'
    return `${model} · ${key} · ${domain} · ${modeLabel}`
  }, [baseUrl, apiKey, modelId, toolMode])

  return (
    <div className={`config-panel ${collapsed ? 'collapsed' : ''}`}>
      {collapsed ? (
        <div className="config-summary-bar" onClick={() => setCollapsed(false)}>
          <div className="summary-left">
            <span className={`status-dot ${hasConfig ? 'active' : ''}`} />
            <span className="summary-text">{configSummary}</span>
          </div>
          <button className="edit-toggle" onClick={(e) => { e.stopPropagation(); setCollapsed(false) }}>
            Edit ▾
          </button>
        </div>
      ) : (
        <>
          <div className="config-header">
            <span className="config-title">Configuration</span>
            <button className="collapse-btn" onClick={() => setCollapsed(true)}>Collapse ▴</button>
          </div>
          <div className="config-row">
            <div className="config-field">
              <label>Base URL</label>
              <input value={baseUrl} onChange={e => setBaseUrl(e.target.value)} type="text" placeholder="https://api.openai.com/v1" />
            </div>
            <div className="config-field">
              <label>API Key</label>
              <input value={apiKey} onChange={e => setApiKey(e.target.value)} type="password" placeholder="sk-..." />
            </div>
            <div className="config-field">
              <label>Model</label>
              <input value={modelId} onChange={e => setModelId(e.target.value)} type="text" placeholder="gpt-4o" />
            </div>
          </div>

          <div className="config-row tool-mode-row">
            <div className="config-field tool-mode-field">
              <label title="Pick the tool-invocation protocol your model/endpoint supports. No automatic fallback.">
                Tool Invocation
              </label>
              <div className="tool-mode-toggle" role="radiogroup" aria-label="Tool invocation mode">
                <button
                  type="button"
                  role="radio"
                  aria-checked={toolMode === 'function_call'}
                  className={`tool-mode-option ${toolMode === 'function_call' ? 'active' : ''}`}
                  onClick={() => setToolMode('function_call')}
                >
                  Function Call
                  <span className="tool-mode-hint">Uses OpenAI <code>tools</code> API</span>
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={toolMode === 'prompt'}
                  className={`tool-mode-option ${toolMode === 'prompt' ? 'active' : ''}`}
                  onClick={() => setToolMode('prompt')}
                >
                  Prompt
                  <span className="tool-mode-hint">Parse <code>shell(command=...)</code> from text</span>
                </button>
              </div>
            </div>
          </div>

        </>
      )}
    </div>
  )
}
