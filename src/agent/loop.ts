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

Use the shell tool to run commands in the sandbox. All skill .py files are pre-loaded in the filesystem.

## Running scripts (argparse / if __name__ == '__main__')
shell(command="python main.py --city Tokyo --unit celsius")

## Running inline Python (quick debugging / function calls)
shell(command="python -c \\"from main import get_weather; print(get_weather('Tokyo'))\\"")

## Multi-line inline Python
shell(command="python -c \\"import json; from main import analyze; result = analyze('data'); print(json.dumps(result, indent=2))\\"")

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

/**
 * Fallback parser for models that output tool calls as text instead of
 * using the structured function calling API.
 * Matches patterns like:
 *   shell(command="python main.py --arg")
 *   execute_python(call_expression="get_weather('Tokyo')")
 *   ```python\nshell(command='...')\n```
 *   ```bash\npython main.py --arg\n```
 */
function parseToolCallFromText(text: string): string | null {
  // Match shell(command="...") or shell(command='...')
  const shellMatch = text.match(/shell\s*\(\s*command\s*=\s*["'`]([\s\S]*?)["'`]\s*\)/)
  if (shellMatch) return shellMatch[1]

  // Match execute_python(call_expression="...") (legacy)
  const execMatch = text.match(/execute_python\s*\(\s*call_expression\s*=\s*["'`]([\s\S]*?)["'`]\s*\)/)
  if (execMatch) return execMatch[1]

  // Match inside code blocks
  const codeBlockMatch = text.match(/```(?:python|bash|sh)?\s*\n?([\s\S]*?)```/)
  if (codeBlockMatch) {
    const code = codeBlockMatch[1].trim()
    // Check for tool call patterns inside code blocks
    const innerShell = code.match(/shell\s*\(\s*command\s*=\s*["'`]([\s\S]*?)["'`]\s*\)/)
    if (innerShell) return innerShell[1]
    const innerExec = code.match(/execute_python\s*\(\s*call_expression\s*=\s*["'`]([\s\S]*?)["'`]\s*\)/)
    if (innerExec) return innerExec[1]
    // Bare code in a code block — use it directly
    if (code && !code.includes('shell(') && !code.includes('execute_python')) return code
  }

  return null
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

  const toolDefs: OpenAI.Chat.ChatCompletionTool[] = [
    {
      type: 'function',
      function: {
        name: 'shell',
        description: 'Run a shell command in the Python sandbox. Use "python script.py args" to run scripts, or "python -c \'code\'" for inline Python.',
        parameters: {
          type: 'object',
          properties: {
            command: {
              type: 'string',
              description: 'The shell command to execute, e.g. "python main.py --city Tokyo" or "python -c \\"from main import func; print(func())\\"'
            }
          },
          required: ['command']
        }
      }
    }
  ]

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
      tools: toolDefs,
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

    // Fallback: parse tool calls from text when model doesn't support function calling
    if (toolCalls.size === 0 && assistantContent) {
      const parsed = parseToolCallFromText(assistantContent)
      if (parsed) {
        onConsole({ type: 'info', message: 'Parsed tool call from text (model did not use function calling)', timestamp: Date.now() })
        onConsole({ type: 'tool', message: `Calling: ${parsed}`, timestamp: Date.now() })

        const result = await sandbox.execute(allCodeFiles, parsed)
        const resultContent = result.success
          ? result.output || '(no output)'
          : `Error: ${result.error}`

        onToolResult('execute_python', resultContent)
        onConsole({
          type: result.success ? 'output' : 'error',
          message: resultContent,
          timestamp: Date.now()
        })

        // Send result back as user message so model can answer naturally
        conversationMessages.push(
          { role: 'assistant', content: assistantContent },
          { role: 'user', content: `Tool execution result:\n${resultContent}\n\nPlease respond to the user based on this result.` }
        )
        messages.push({
          id: generateId(),
          role: 'tool',
          content: resultContent,
          timestamp: Date.now()
        })

        continue // next iteration, model will see the result and answer
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
        callExpression = args.command || args.call_expression || tc.arguments
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
