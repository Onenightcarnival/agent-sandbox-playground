import { useState, useEffect, useMemo } from 'react'
import type { LLMConfig, ToolMode } from '@/types'
import './ConfigPanel.css'

interface Props {
  onConfigChange: (config: LLMConfig) => void
  onEnvVarsChange: (vars: Record<string, string>) => void
}

interface EnvVar {
  key: string
  value: string
}

const STORAGE_KEY = 'agent-sandbox-config'
const ENV_STORAGE_KEY = 'agent-sandbox-env'

export default function ConfigPanel({ onConfigChange, onEnvVarsChange }: Props) {
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [modelId, setModelId] = useState('')
  const [toolMode, setToolMode] = useState<ToolMode>('function_call')
  const [envVars, setEnvVars] = useState<EnvVar[]>([])
  const [collapsed, setCollapsed] = useState(true)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
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
      }
    } catch {}
    try {
      const savedEnv = localStorage.getItem(ENV_STORAGE_KEY)
      if (savedEnv) setEnvVars(JSON.parse(savedEnv))
    } catch {}
    setHydrated(true)
  }, [])

  const envVarsMap = useMemo(() => {
    const vars: Record<string, string> = {
      OPENAI_BASE_URL: baseUrl,
      OPENAI_API_KEY: apiKey,
      MODEL_ID: modelId
    }
    for (const { key, value } of envVars) {
      if (key.trim()) vars[key.trim()] = value
    }
    return vars
  }, [baseUrl, apiKey, modelId, envVars])

  useEffect(() => {
    if (!hydrated) return
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ baseUrl, apiKey, modelId, toolMode }))
    onConfigChange({ baseUrl, apiKey, modelId, toolMode })
  }, [baseUrl, apiKey, modelId, toolMode, hydrated, onConfigChange])

  useEffect(() => {
    if (!hydrated) return
    localStorage.setItem(ENV_STORAGE_KEY, JSON.stringify(envVars))
  }, [envVars, hydrated])

  useEffect(() => {
    if (!hydrated) return
    onEnvVarsChange(envVarsMap)
  }, [envVarsMap, hydrated, onEnvVarsChange])

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

  const addEnvVar = () => setEnvVars(prev => [...prev, { key: '', value: '' }])
  const removeEnvVar = (index: number) =>
    setEnvVars(prev => prev.filter((_, i) => i !== index))
  const updateEnvVar = (index: number, field: 'key' | 'value', value: string) =>
    setEnvVars(prev => prev.map((v, i) => (i === index ? { ...v, [field]: value } : v)))

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

          <div className="env-section">
            <label className="env-label">Environment Variables</label>
            <div className="env-list">
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
        </>
      )}
    </div>
  )
}
