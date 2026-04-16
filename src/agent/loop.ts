import type OpenAI from 'openai'
import type { ChatMessage, ConsoleEntry, Skill } from '@/types'
import { PyodideSandbox } from '@/sandbox/sandbox'

interface AgentLoopOptions {
  client: OpenAI
  modelId: string
  skills: Skill[]
  messages: ChatMessage[]
  sandbox: PyodideSandbox
  onAssistantChunk: (chunk: string) => void
  onToolCall: (name: string, args: string) => void
  onToolResult: (name: string, result: string) => void
  onConsole: (entry: ConsoleEntry) => void
  onDone: (message: ChatMessage) => void
  signal?: AbortSignal
}

function buildSystemPrompt(skills: Skill[]): string {
  if (skills.length === 0) {
    return 'You are a helpful assistant. No skills are loaded.'
  }

  const skillSections = skills.map((skill, i) => {
    const filesSection = skill.files
      .map(f => `### ${f.name}\n\`\`\`python\n${f.content}\n\`\`\``)
      .join('\n\n')

    return `## Skill ${i + 1}: ${skill.name}

<skill_description>
${skill.skillMd}
</skill_description>

<skill_implementation>
${filesSection}
</skill_implementation>`
  }).join('\n\n---\n\n')

  return `You are a helpful assistant with access to custom Python tools.

# Available Skills

${skillSections}

# How to Use Tools

When you need to call a tool, use the execute_python function. Provide a Python code snippet to execute.
All skill .py files are written to the sandbox filesystem as importable modules. You MUST import before calling.

The call_expression can be multiple lines of Python (use \\n for newlines). Always import first, then call.

Examples:
- execute_python(call_expression="from main import get_weather\\nget_weather('Tokyo')")
- execute_python(call_expression="from analyzer import analyze_csv\\nanalyze_csv('data.csv')")

Analyze each skill's description and Python code carefully to understand what modules and functions are available.`
}

function collectAllCodeFiles(skills: Skill[]): { name: string; content: string }[] {
  const codeFiles: { name: string; content: string }[] = []
  for (const skill of skills) {
    for (const file of skill.files) {
      codeFiles.push({ name: `${skill.name}/${file.name}`, content: file.content })
    }
  }
  return codeFiles
}

function toOpenAIMessages(messages: ChatMessage[]): OpenAI.Chat.ChatCompletionMessageParam[] {
  return messages
    .filter(m => m.role !== 'system')
    .map(m => {
      if (m.role === 'tool') {
        return {
          role: 'tool' as const,
          content: m.content,
          tool_call_id: m.toolCallId || ''
        }
      }
      if (m.role === 'assistant' && m.toolCalls?.length) {
        return {
          role: 'assistant' as const,
          content: m.content || null,
          tool_calls: m.toolCalls.map(tc => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.function.name,
              arguments: tc.function.arguments
            }
          }))
        }
      }
      return {
        role: m.role as 'user' | 'assistant',
        content: m.content
      }
    })
}

function generateId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

export async function runAgentLoop(options: AgentLoopOptions) {
  const {
    client, modelId, skills,
    messages, sandbox,
    onAssistantChunk, onToolCall, onToolResult, onConsole, onDone,
    signal
  } = options

  const systemPrompt = buildSystemPrompt(skills)
  const allCodeFiles = collectAllCodeFiles(skills)
  const conversationMessages = toOpenAIMessages(messages)

  const toolDef: OpenAI.Chat.ChatCompletionTool = {
    type: 'function',
    function: {
      name: 'execute_python',
      description: 'Execute a Python expression in the sandbox. All skill code is pre-loaded, so you can call any defined function directly.',
      parameters: {
        type: 'object',
        properties: {
          call_expression: {
            type: 'string',
            description: 'The Python expression to evaluate, e.g. get_weather("Tokyo", unit="celsius")'
          }
        },
        required: ['call_expression']
      }
    }
  }

  let iterationCount = 0
  const maxIterations = 10

  while (iterationCount < maxIterations) {
    iterationCount++

    if (signal?.aborted) {
      onConsole({ type: 'info', message: 'Agent loop aborted', timestamp: Date.now() })
      return
    }

    const stream = await client.chat.completions.create({
      model: modelId,
      messages: [
        { role: 'system', content: systemPrompt },
        ...conversationMessages
      ],
      tools: [toolDef],
      stream: true
    })

    let assistantContent = ''
    const toolCalls: Map<number, { id: string; name: string; arguments: string }> = new Map()

    for await (const chunk of stream) {
      if (signal?.aborted) return

      const delta = chunk.choices[0]?.delta
      if (!delta) continue

      if (delta.content) {
        assistantContent += delta.content
        onAssistantChunk(delta.content)
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const existing = toolCalls.get(tc.index) || { id: '', name: '', arguments: '' }
          if (tc.id) existing.id = tc.id
          if (tc.function?.name) existing.name = tc.function.name
          if (tc.function?.arguments) existing.arguments += tc.function.arguments
          toolCalls.set(tc.index, existing)
        }
      }
    }

    if (toolCalls.size === 0) {
      onDone({
        id: generateId(),
        role: 'assistant',
        content: assistantContent,
        timestamp: Date.now()
      })
      return
    }

    const assistantMsg: ChatMessage = {
      id: generateId(),
      role: 'assistant',
      content: assistantContent,
      toolCalls: Array.from(toolCalls.values()).map(tc => ({
        id: tc.id,
        function: { name: tc.name, arguments: tc.arguments }
      })),
      timestamp: Date.now()
    }

    conversationMessages.push({
      role: 'assistant',
      content: assistantContent || null,
      tool_calls: assistantMsg.toolCalls!.map(tc => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.function.name, arguments: tc.function.arguments }
      }))
    })

    for (const tc of toolCalls.values()) {
      let callExpression: string
      try {
        const args = JSON.parse(tc.arguments)
        callExpression = args.call_expression || tc.arguments
      } catch {
        callExpression = tc.arguments
      }

      onToolCall(tc.name, callExpression)
      onConsole({ type: 'tool', message: `Calling: ${callExpression}`, timestamp: Date.now() })

      const result = await sandbox.execute(allCodeFiles, callExpression)

      const resultContent = result.success
        ? result.output || '(no output)'
        : `Error: ${result.error}`

      onToolResult(tc.name, resultContent)
      onConsole({
        type: result.success ? 'output' : 'error',
        message: resultContent,
        timestamp: Date.now()
      })

      for (const log of result.logs) {
        onConsole({ type: 'info', message: log, timestamp: Date.now() })
      }

      conversationMessages.push({
        role: 'tool',
        content: resultContent,
        tool_call_id: tc.id
      })

      messages.push({
        id: generateId(),
        role: 'tool',
        content: resultContent,
        toolCallId: tc.id,
        timestamp: Date.now()
      })
    }
  }

  onConsole({ type: 'error', message: 'Max iterations reached', timestamp: Date.now() })
}
