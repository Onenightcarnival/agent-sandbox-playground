import { useState, useRef, useEffect, useCallback } from 'react'
import ConfigPanel from './ConfigPanel'
import SkillManager from './SkillManager'
import SkillEditor from './SkillEditor'
import ChatPanel from './ChatPanel'
import ConsolePanel from './ConsolePanel'
import { createClient } from '@/agent/openai-client'
import { runAgentLoop } from '@/agent/loop'
import { PyodideSandbox } from '@/sandbox/sandbox'
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
  const abortControllerRef = useRef<AbortController | null>(null)

  const appendConsole = useCallback((entry: ConsoleEntry) => {
    setConsoleEntries(prev => [...prev, entry])
  }, [])

  useEffect(() => {
    const sandbox = new PyodideSandbox()
    sandboxRef.current = sandbox
    sandbox.setLogCallback((entry) => appendConsole(entry))

    appendConsole({ type: 'info', message: 'Initializing Pyodide sandbox...', timestamp: Date.now() })

    sandbox.init()
      .then(() => {
        setSandboxReady(true)
        appendConsole({ type: 'info', message: 'Pyodide sandbox ready', timestamp: Date.now() })
      })
      .catch((e: any) => {
        appendConsole({ type: 'error', message: `Failed to init sandbox: ${e.message}`, timestamp: Date.now() })
      })

    return () => {
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
      message: `Loaded skill: ${skill.name} (${skill.files.length} Python files)`,
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
    if (!sandboxReady || !sandboxRef.current) {
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
      await runAgentLoop({
        client,
        modelId: config.modelId,
        toolMode: config.toolMode,
        skills,
        messages: workingMessages,
        sandbox: sandboxRef.current,
        envVars,
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
