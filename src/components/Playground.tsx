import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import ConfigPanel from './ConfigPanel'
import SkillManager from './SkillManager'
import SkillEditor, { type PendingReveal } from './SkillEditor'
import InspectPanel, { type EnvVar } from './InspectPanel'
import ChatPanel from './ChatPanel'
import ConsolePanel from './ConsolePanel'
import CommandPalette, { type PaletteCommand, type PaletteFile, type PaletteMode } from './CommandPalette'
import { createClient } from '@/agent/openai-client'
import { runAgentLoop, type NamedMCPClient } from '@/agent/loop'
import { DEFAULT_SYSTEM_PROMPT } from '@/agent/default-prompt'
import { PyodideSandbox } from '@/sandbox/sandbox'
import { createSandboxMCP } from '@/mcp/sandbox-server'
import { createFSMCP } from '@/mcp/fs-server'
import { useCosmicTheme } from '@/hooks/useCosmicTheme'
import type { Client as MCPClient } from '@modelcontextprotocol/sdk/client/index.js'
import type { Tool as MCPTool } from '@modelcontextprotocol/sdk/types.js'
import type { LLMConfig, ChatMessage, ConsoleEntry, Skill } from '@/types'
import './Playground.css'

const SYSTEM_PROMPT_STORAGE_KEY = 'agent-sandbox-system-prompt'
const ENV_STORAGE_KEY = 'agent-sandbox-env'

export interface MCPServerInfo {
  /** Namespacing prefix used in tool names (e.g. "fs", "sandbox"). */
  prefix: string
  /** Human-readable server name from MCP `serverInfo.name`. */
  name: string
  /** Server-advertised `instructions` field, if any. */
  instructions: string
  tools: MCPTool[]
}

type LeftTab = 'skills' | 'inspect'

export default function Playground() {
  const [config, setConfig] = useState<LLMConfig>({ baseUrl: '', apiKey: '', modelId: '', toolMode: 'function_call' })
  const [skills, setSkills] = useState<Skill[]>([])
  const [selectedSkillId, setSelectedSkillId] = useState('')
  const [openFiles, setOpenFiles] = useState<string[]>(['SKILL.md'])
  const [activeFileName, setActiveFileName] = useState<string | null>('SKILL.md')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [consoleEntries, setConsoleEntries] = useState<ConsoleEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [sandboxReady, setSandboxReady] = useState(false)
  const [leftCollapsed, setLeftCollapsed] = useState(false)
  const [rightCollapsed, setRightCollapsed] = useState(false)
  const [editorFullscreen, setEditorFullscreen] = useState(false)
  const [leftTab, setLeftTab] = useState<LeftTab>('skills')
  const [systemPrompt, setSystemPrompt] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(SYSTEM_PROMPT_STORAGE_KEY)
      if (saved !== null) return saved
    } catch {}
    return DEFAULT_SYSTEM_PROMPT
  })
  const [customEnvVars, setCustomEnvVars] = useState<EnvVar[]>(() => {
    try {
      const saved = localStorage.getItem(ENV_STORAGE_KEY)
      if (saved) return JSON.parse(saved)
    } catch {}
    return []
  })
  const [mcpServers, setMcpServers] = useState<MCPServerInfo[]>([])
  const [workspaceRefreshKey, setWorkspaceRefreshKey] = useState(0)
  const bumpWorkspace = useCallback(() => setWorkspaceRefreshKey(k => k + 1), [])
  const [paletteMode, setPaletteMode] = useState<PaletteMode | null>(null)
  const [pendingReveal, setPendingReveal] = useState<PendingReveal | null>(null)
  const { theme, toggleTheme } = useCosmicTheme()

  useEffect(() => {
    try {
      localStorage.setItem(SYSTEM_PROMPT_STORAGE_KEY, systemPrompt)
    } catch {}
  }, [systemPrompt])

  useEffect(() => {
    try {
      localStorage.setItem(ENV_STORAGE_KEY, JSON.stringify(customEnvVars))
    } catch {}
  }, [customEnvVars])

  // Full env map handed to the sandbox MCP: config values auto-exposed under
  // canonical names, plus whatever the user added in the Inspect panel.
  const envVars = useMemo<Record<string, string>>(() => {
    const vars: Record<string, string> = {
      OPENAI_BASE_URL: config.baseUrl,
      OPENAI_API_KEY: config.apiKey,
      MODEL_ID: config.modelId,
    }
    for (const { key, value } of customEnvVars) {
      const k = key.trim()
      if (k) vars[k] = value
    }
    return vars
  }, [config.baseUrl, config.apiKey, config.modelId, customEnvVars])

  const sandboxRef = useRef<PyodideSandbox | null>(null)
  const sandboxClientRef = useRef<MCPClient | null>(null)
  const fsClientRef = useRef<MCPClient | null>(null)
  const skillsRef = useRef<Skill[]>([])
  const envVarsRef = useRef<Record<string, string>>({})
  const abortControllerRef = useRef<AbortController | null>(null)

  // Keep refs in sync so the MCP server's tool handlers always see the latest
  // skills/env — captured via getters at server-creation time.
  useEffect(() => { skillsRef.current = skills }, [skills])
  useEffect(() => { envVarsRef.current = envVars }, [envVars])

  // Global IDE-style shortcuts for the command palette.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      const key = e.key.toLowerCase()
      if (e.shiftKey && key === 'p') { e.preventDefault(); setPaletteMode('command') }
      else if (e.shiftKey && key === 'f') { e.preventDefault(); setPaletteMode('search') }
      else if (!e.shiftKey && key === 'p') { e.preventDefault(); setPaletteMode('file') }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const appendConsole = useCallback((entry: ConsoleEntry) => {
    setConsoleEntries(prev => [...prev, entry])
  }, [])

  useEffect(() => {
    const sandbox = new PyodideSandbox()
    sandboxRef.current = sandbox
    sandbox.setLogCallback((entry) => appendConsole(entry))

    appendConsole({ type: 'info', message: 'Initializing Pyodide sandbox...', timestamp: Date.now() })

    sandbox.init()
      .then(async () => {
        const [sandboxClient, fsClient] = await Promise.all([
          createSandboxMCP({ sandbox, getEnvVars: () => envVarsRef.current }),
          createFSMCP({ getSkills: () => skillsRef.current }),
        ])
        sandboxClientRef.current = sandboxClient
        fsClientRef.current = fsClient
        // Dev-only: exposes live MCP clients so tool calls can be driven from
        // the devtools console without the LLM in the loop.
        if ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV) {
          ;(window as unknown as { __mcp?: { sandbox: MCPClient; fs: MCPClient } }).__mcp = {
            sandbox: sandboxClient,
            fs: fsClient,
          }
        }
        const [sandboxTools, fsTools] = await Promise.all([
          sandboxClient.listTools(),
          fsClient.listTools(),
        ])
        const servers: MCPServerInfo[] = [
          {
            prefix: 'fs',
            name: fsClient.getServerVersion?.()?.name ?? 'fs',
            instructions: fsClient.getInstructions?.() ?? '',
            tools: fsTools.tools,
          },
          {
            prefix: 'sandbox',
            name: sandboxClient.getServerVersion?.()?.name ?? 'sandbox',
            instructions: sandboxClient.getInstructions?.() ?? '',
            tools: sandboxTools.tools,
          },
        ]
        setMcpServers(servers)
        setSandboxReady(true)
        bumpWorkspace()
        appendConsole({
          type: 'info',
          message: `Sandbox MCP: ${sandboxTools.tools.map(t => t.name).join(', ')}`,
          timestamp: Date.now(),
        })
        appendConsole({
          type: 'info',
          message: `FS MCP (read-only): ${fsTools.tools.map(t => t.name).join(', ')}`,
          timestamp: Date.now(),
        })
      })
      .catch((e: any) => {
        appendConsole({ type: 'error', message: `Failed to init sandbox: ${e.message}`, timestamp: Date.now() })
      })

    return () => {
      sandboxClientRef.current?.close().catch(() => {})
      fsClientRef.current?.close().catch(() => {})
      sandboxClientRef.current = null
      fsClientRef.current = null
      sandbox.terminate()
      sandboxRef.current = null
    }
  }, [appendConsole])

  const handleAddSkill = (skill: Skill) => {
    setSkills(prev => [...prev, skill])
    setSelectedSkillId(skill.id)
    setOpenFiles(['SKILL.md'])
    setActiveFileName('SKILL.md')
    appendConsole({
      type: 'info',
      message: `Loaded skill: ${skill.name} (${skill.files.length} files)`,
      timestamp: Date.now()
    })

    if (skill.requirements && sandboxRef.current) {
      const packages = skill.requirements
        .split('\n')
        .map(l => l.trim().replace(/[>=<].*/, ''))
        .filter(l => l && !l.startsWith('#'))

      if (packages.length > 0) {
        appendConsole({
          type: 'info',
          message: `Installing packages: ${packages.join(', ')}`,
          timestamp: Date.now()
        })
        sandboxRef.current.installPackages(packages)
      }
    }
  }

  const handleRemoveSkill = (id: string) => {
    setSkills(prev => {
      const next = prev.filter(s => s.id !== id)
      if (selectedSkillId === id) {
        setSelectedSkillId(next[0]?.id || '')
        setOpenFiles(['SKILL.md'])
        setActiveFileName('SKILL.md')
      }
      return next
    })
  }

  const handleSelectSkill = (id: string) => {
    setSelectedSkillId(id)
    setOpenFiles(['SKILL.md'])
    setActiveFileName('SKILL.md')
  }

  const handleOpenFile = (fileName: string) => {
    setOpenFiles(prev => prev.includes(fileName) ? prev : [...prev, fileName])
    setActiveFileName(fileName)
  }

  const handleOpenFileAtLine = useCallback((fileName: string, line: number, column?: number) => {
    setOpenFiles(prev => prev.includes(fileName) ? prev : [...prev, fileName])
    setActiveFileName(fileName)
    setPendingReveal({ fileName, line, column, nonce: Date.now() })
  }, [])

  const handleCloseFile = (fileName: string) => {
    setOpenFiles(prev => {
      const idx = prev.indexOf(fileName)
      if (idx === -1) return prev
      const next = prev.filter(n => n !== fileName)
      if (activeFileName === fileName) {
        setActiveFileName(next[idx] ?? next[idx - 1] ?? null)
      }
      return next
    })
  }

  const handleUpdateFile = (payload: { skillId: string; fileName: string; content: string }) => {
    setSkills(prev => prev.map(skill => {
      if (skill.id !== payload.skillId) return skill
      if (payload.fileName === 'SKILL.md') {
        return { ...skill, skillMd: payload.content }
      }
      if (payload.fileName === 'requirements.txt') {
        return { ...skill, requirements: payload.content }
      }
      return {
        ...skill,
        files: skill.files.map(f => f.name === payload.fileName ? { ...f, content: payload.content } : f)
      }
    }))
  }

  const handleAddFile = (skillId: string) => {
    setSkills(prev => prev.map(skill => {
      if (skill.id !== skillId) return skill
      let name = 'scripts/new_module.py'
      let counter = 1
      while (skill.files.some(f => f.name === name)) {
        name = `scripts/new_module_${counter++}.py`
      }
      setOpenFiles(open => open.includes(name) ? open : [...open, name])
      setActiveFileName(name)
      return { ...skill, files: [...skill.files, { name, content: '' }] }
    }))
  }

  const handleDeleteFile = (payload: { skillId: string; fileName: string }) => {
    setSkills(prev => prev.map(skill => {
      if (skill.id !== payload.skillId) return skill
      return { ...skill, files: skill.files.filter(f => f.name !== payload.fileName) }
    }))
    setOpenFiles(prev => prev.filter(n => n !== payload.fileName))
    if (activeFileName === payload.fileName) {
      setActiveFileName(prev => {
        const remaining = openFiles.filter(n => n !== payload.fileName)
        return remaining[0] ?? null
      })
    }
  }

  const handleSend = async (text: string) => {
    if (!config.baseUrl || !config.apiKey || !config.modelId) {
      appendConsole({ type: 'error', message: 'Please fill in Base URL, API Key, and Model', timestamp: Date.now() })
      return
    }
    if (!sandboxReady || !sandboxRef.current || !sandboxClientRef.current || !fsClientRef.current) {
      appendConsole({ type: 'error', message: 'Sandbox is not ready yet', timestamp: Date.now() })
      return
    }
    if (skills.length === 0) {
      appendConsole({ type: 'error', message: 'No skills loaded. Upload a .zip skill first.', timestamp: Date.now() })
      return
    }

    const userMsg: ChatMessage = {
      id: `msg_${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: Date.now()
    }

    // Use a local array that the agent loop can mutate, then sync to state at key points.
    const workingMessages: ChatMessage[] = [...messages, userMsg]
    setMessages(workingMessages)

    setLoading(true)
    setStreamingContent('')
    abortControllerRef.current = new AbortController()

    try {
      const client = createClient(config)
      const mcpClients: NamedMCPClient[] = [
        { prefix: 'fs', client: fsClientRef.current },
        { prefix: 'sandbox', client: sandboxClientRef.current },
      ]
      await runAgentLoop({
        client,
        modelId: config.modelId,
        toolMode: config.toolMode,
        messages: workingMessages,
        mcpClients,
        systemPrompt,
        signal: abortControllerRef.current.signal,
        onAssistantChunk(chunk) {
          setStreamingContent(prev => prev + chunk)
        },
        onToolCall(name, args) {
          appendConsole({ type: 'tool', message: `Tool call: ${name} -> ${args}`, timestamp: Date.now() })
        },
        onToolResult(name, result) {
          appendConsole({ type: 'output', message: `Tool result: ${result}`, timestamp: Date.now() })
          if (name.startsWith('sandbox__')) bumpWorkspace()
        },
        onConsole(entry) {
          appendConsole(entry)
        },
        onDone(msg) {
          workingMessages.push(msg)
          setMessages([...workingMessages])
          setStreamingContent('')
        }
      })
      // Sync any tool/assistant messages that the loop appended directly to workingMessages
      setMessages([...workingMessages])
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        appendConsole({ type: 'error', message: `Error: ${e.message}`, timestamp: Date.now() })
      }
    } finally {
      setLoading(false)
      setStreamingContent('')
      abortControllerRef.current = null
    }
  }

  const handleStop = () => abortControllerRef.current?.abort()
  const clearConsole = () => setConsoleEntries([])
  const clearChat = () => {
    setMessages([])
    setStreamingContent('')
  }

  const paletteFiles = useMemo<PaletteFile[]>(() => {
    const skill = skills.find(s => s.id === selectedSkillId)
    if (!skill) return []
    const out: PaletteFile[] = [{ path: 'SKILL.md', content: skill.skillMd }]
    for (const f of skill.files) out.push({ path: f.name, content: f.content })
    if (skill.requirements) out.push({ path: 'requirements.txt', content: skill.requirements })
    return out
  }, [skills, selectedSkillId])

  const paletteCommands = useMemo<PaletteCommand[]>(() => {
    const cmds: PaletteCommand[] = []
    if (activeFileName) {
      cmds.push({
        id: 'close-tab',
        label: `Close Tab: ${activeFileName}`,
        run: () => handleCloseFile(activeFileName),
      })
    }
    cmds.push({
      id: 'toggle-fullscreen',
      label: editorFullscreen ? 'Exit Fullscreen Editor' : 'Enter Fullscreen Editor',
      run: () => setEditorFullscreen(f => !f),
    })
    cmds.push({
      id: 'toggle-theme',
      label: theme === 'night' ? 'Theme: Switch to Dusk' : 'Theme: Switch to Night',
      run: toggleTheme,
    })
    for (const s of skills) {
      if (s.id !== selectedSkillId) {
        cmds.push({
          id: `switch-skill-${s.id}`,
          label: `Switch Skill: ${s.name}`,
          run: () => handleSelectSkill(s.id),
        })
      }
    }
    return cmds
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFileName, editorFullscreen, theme, toggleTheme, skills, selectedSkillId])

  const layoutClass = [
    'main-layout',
    editorFullscreen && 'editor-fullscreen',
    !editorFullscreen && leftCollapsed && 'left-collapsed',
    !editorFullscreen && rightCollapsed && 'right-collapsed'
  ].filter(Boolean).join(' ')

  return (
    <div className="playground">
      <ConfigPanel onConfigChange={setConfig} />

      <div className={layoutClass}>
        {!leftCollapsed ? (
          <div className="left-panel">
            <div className="panel-header">
              <div className="left-tabs" role="tablist" aria-label="Left panel">
                <button
                  role="tab"
                  aria-selected={leftTab === 'skills'}
                  className={`left-tab ${leftTab === 'skills' ? 'active' : ''}`}
                  onClick={() => setLeftTab('skills')}
                >
                  Skills
                </button>
                <button
                  role="tab"
                  aria-selected={leftTab === 'inspect'}
                  className={`left-tab ${leftTab === 'inspect' ? 'active' : ''}`}
                  onClick={() => setLeftTab('inspect')}
                >
                  Inspect
                </button>
              </div>
              <div className="panel-header-actions">
                <button
                  className={`panel-toggle ${editorFullscreen ? 'active' : ''}`}
                  onClick={() => setEditorFullscreen(f => !f)}
                  title={editorFullscreen ? 'Restore default layout' : 'Fullscreen editor'}
                >
                  {editorFullscreen ? '⤢' : '⛶'}
                </button>
                {!editorFullscreen && (
                  <button className="panel-toggle" onClick={() => setLeftCollapsed(true)} title="Collapse">◀</button>
                )}
              </div>
            </div>
            {leftTab === 'skills' ? (
              <>
                <SkillManager
                  skills={skills}
                  onAdd={handleAddSkill}
                  onRemove={handleRemoveSkill}
                  onSelect={handleSelectSkill}
                />
                <div className="editor-section">
                  <SkillEditor
                    skills={skills}
                    selectedSkillId={selectedSkillId}
                    openFiles={openFiles}
                    activeFileName={activeFileName}
                    pendingReveal={pendingReveal}
                    onSelectSkill={handleSelectSkill}
                    onOpenFile={handleOpenFile}
                    onCloseFile={handleCloseFile}
                    onUpdateFile={handleUpdateFile}
                    onAddFile={handleAddFile}
                    onDeleteFile={handleDeleteFile}
                  />
                </div>
              </>
            ) : (
              <div className="inspect-container">
                <InspectPanel
                  envVars={customEnvVars}
                  onEnvVarsChange={setCustomEnvVars}
                  systemPrompt={systemPrompt}
                  defaultSystemPrompt={DEFAULT_SYSTEM_PROMPT}
                  onSystemPromptChange={setSystemPrompt}
                  mcpServers={mcpServers}
                />
              </div>
            )}
          </div>
        ) : (
          <div className="collapsed-strip left-strip" onClick={() => setLeftCollapsed(false)}>
            <span className="strip-icon">▶</span>
            <span className="strip-label">{leftTab === 'skills' ? 'Skills' : 'Inspect'}</span>
          </div>
        )}

        {!editorFullscreen && (
          <div className="center-panel">
            <div className="section-header">
              <span>Chat</span>
              <div className="header-actions">
                {skills.length > 0 && (
                  <span className="skill-count">{skills.length} skill{skills.length !== 1 ? 's' : ''}</span>
                )}
                <button className="header-btn" onClick={clearChat}>Clear</button>
              </div>
            </div>
            <ChatPanel
              messages={messages}
              loading={loading}
              streamingContent={streamingContent}
              onSend={handleSend}
              onStop={handleStop}
            />
          </div>
        )}

        {!editorFullscreen && (!rightCollapsed ? (
          <div className="right-panel">
            <ConsolePanel
              entries={consoleEntries}
              onClear={clearConsole}
              onCollapse={() => setRightCollapsed(true)}
              sandbox={sandboxRef.current}
              sandboxReady={sandboxReady}
              workspaceRefreshKey={workspaceRefreshKey}
            />
          </div>
        ) : (
          <div className="collapsed-strip right-strip" onClick={() => setRightCollapsed(false)}>
            <span className="strip-icon">◀</span>
            <span className="strip-label">Console</span>
            {consoleEntries.length > 0 && (
              <span className="strip-badge">{consoleEntries.length}</span>
            )}
          </div>
        ))}
      </div>

      {!sandboxReady && (
        <div className="sandbox-status">Loading Pyodide sandbox...</div>
      )}

      {paletteMode && (
        <CommandPalette
          mode={paletteMode}
          files={paletteFiles}
          commands={paletteCommands}
          onClose={() => setPaletteMode(null)}
          onModeChange={setPaletteMode}
          onOpenFile={handleOpenFile}
          onOpenFileAtLine={handleOpenFileAtLine}
        />
      )}
    </div>
  )
}
