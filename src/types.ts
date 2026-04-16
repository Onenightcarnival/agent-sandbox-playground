export interface LLMConfig {
  baseUrl: string
  apiKey: string
  modelId: string
}

export interface ChatMessage {
  id: string
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  toolCallId?: string
  toolCalls?: ToolCall[]
  timestamp: number
}

export interface ToolCall {
  id: string
  function: {
    name: string
    arguments: string
  }
}

export interface SkillFile {
  name: string
  content: string
}

export interface Skill {
  id: string
  name: string
  description: string
  skillMd: string
  files: SkillFile[]
  requirements: string
}

export interface SandboxResult {
  success: boolean
  output: string
  error?: string
  logs: string[]
}

export interface ConsoleEntry {
  type: 'info' | 'error' | 'output' | 'tool'
  message: string
  timestamp: number
}
