import { useState, useRef, useEffect, useCallback } from 'react'
import ConfigPanel from './ConfigPanel'
import SkillManager from './SkillManager'
import SkillEditor from './SkillEditor'
import ChatPanel from './ChatPanel'
import ConsolePanel from './ConsolePanel'
import { createClient } from '@/agent/openai-client'
import { runAgentLoop, type NamedMCPClient } from '@/agent/loop'
import { PyodideSandbox } from '@/sandbox/sandbox'
import { createSandboxMCP } from '@/mcp/sandbox-server'
import { createFSMCP } from '@/mcp/fs-server'
import type { Client as MCPClient } from '@modelcontextprotocol/sdk/client/index.js'
import type { LLMConfig, ChatMessage, ConsoleEntry, Skill } from '@/types'
import './Playground.css'

export default function Playground() {
  const [config, setConfig] = useState<LLMConfig>({ baseUrl: '', apiKey: '', modelId: '', toolMode: 'function_call' })
  const [skills, setSkills] = useState<Skill[]>([])
  const [selectedSkillId, setSelectedSkillId] = useState('')
  const [selectedFileName, setSelectedFileName] = useState('SKILL.md')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [consoleEntries, setConsoleEntries] = useState<ConsoleEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [sandboxReady, setSandboxReady] = useState(false)
  const [envVars, setEnvVars] = useState<Record<string, string>>({})
  const [leftCollapsed, setLeftCollapsed] = useState(false)
  const [rightCollapsed, setRightCollapsed] = useState(false)

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
        setSandboxReady(true)
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
    setSelectedFileName('SKILL.md')
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
        setSelectedFileName('SKILL.md')
      }
      return next
    })
  }

  const handleSelectSkill = (id: string) => {
    setSelectedSkillId(id)
    setSelectedFileName('SKILL.md')
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
      let name = 'new_module.py'
      let counter = 1
      while (skill.files.some(f => f.name === name)) {
        name = `new_module_${counter++}.py`
      }
      setSelectedFileName(name)
      return { ...skill, files: [...skill.files, { name, content: '' }] }
    }))
  }

  const handleRemoveFile = (payload: { skillId: string; fileName: string }) => {
    setSkills(prev => prev.map(skill => {
      if (skill.id !== payload.skillId) return skill
      return { ...skill, files: skill.files.filter(f => f.name !== payload.fileName) }
    }))
    if (selectedFileName === payload.fileName) {
      setSelectedFileName('SKILL.md')
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
      // Business-layer prompt hint. MCP servers stay generic — this is where
      // the playground (the "agent container") teaches the LLM how to map the
      // user's domain vocabulary ("skill") onto the generic tools.
      const systemPromptExtra = `The read-only filesystem (fs MCP) holds a library of *skills*. Each top-level directory is one skill; its SKILL.md describes what the skill does and how to call it. When the user's request references a skill (e.g. "通过 X 告诉我…", "using the X skill", "run X"), do NOT answer from memory — instead:

1. List files in the fs MCP to locate the relevant skill directory.
2. Read its SKILL.md to learn how to invoke it.
3. Copy the needed source files from the fs MCP into the sandbox (sandbox.write_file).
4. Run the skill in the sandbox (sandbox.shell).
5. Report the sandbox output as your answer.

Skill outputs may differ from naive textbook computation (e.g. applied calibration) — so trust the sandbox result, not your prior knowledge.

If the user's question has no skill reference and no tool is needed, answer directly without invoking tools.`

      await runAgentLoop({
        client,
        modelId: config.modelId,
        toolMode: config.toolMode,
        messages: workingMessages,
        mcpClients,
        systemPromptExtra,
        signal: abortControllerRef.current.signal,
        onAssistantChunk(chunk) {
          setStreamingContent(prev => prev + chunk)
        },
        onToolCall(name, args) {
          appendConsole({ type: 'tool', message: `Tool call: ${name} -> ${args}`, timestamp: Date.now() })
        },
        onToolResult(_name, result) {
          appendConsole({ type: 'output', message: `Tool result: ${result}`, timestamp: Date.now() })
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

  const layoutClass = [
    'main-layout',
    leftCollapsed && 'left-collapsed',
    rightCollapsed && 'right-collapsed'
  ].filter(Boolean).join(' ')

  return (
    <div className="playground">
      <ConfigPanel
        onConfigChange={setConfig}
        onEnvVarsChange={setEnvVars}
      />

      <div className={layoutClass}>
        {!leftCollapsed ? (
          <div className="left-panel">
            <div className="panel-header">
              <span>Code</span>
              <button className="panel-toggle" onClick={() => setLeftCollapsed(true)} title="Collapse">◀</button>
            </div>
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
                selectedFileName={selectedFileName}
                onSelectSkill={setSelectedSkillId}
                onSelectFile={setSelectedFileName}
                onUpdateFile={handleUpdateFile}
                onAddFile={handleAddFile}
                onRemoveFile={handleRemoveFile}
              />
            </div>
          </div>
        ) : (
          <div className="collapsed-strip left-strip" onClick={() => setLeftCollapsed(false)}>
            <span className="strip-icon">▶</span>
            <span className="strip-label">Code</span>
          </div>
        )}

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

        {!rightCollapsed ? (
          <div className="right-panel">
            <ConsolePanel
              entries={consoleEntries}
              onClear={clearConsole}
              onCollapse={() => setRightCollapsed(true)}
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
        )}
      </div>

      {!sandboxReady && (
        <div className="sandbox-status">Loading Pyodide sandbox...</div>
      )}
    </div>
  )
}
