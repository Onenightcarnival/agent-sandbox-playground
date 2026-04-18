import type OpenAI from 'openai'
import type { Client as MCPClient } from '@modelcontextprotocol/sdk/client/index.js'
import type { ChatMessage, ConsoleEntry, Skill, ToolMode } from '@/types'

interface AgentLoopOptions {
  client: OpenAI
  modelId: string
  toolMode: ToolMode
  skills: Skill[]
  messages: ChatMessage[]
  mcpClient: MCPClient
  envVars?: Record<string, string>
  onAssistantChunk: (chunk: string) => void
  onToolCall: (name: string, args: string) => void
  onToolResult: (name: string, result: string) => void
  onConsole: (entry: ConsoleEntry) => void
  onDone: (message: ChatMessage) => void
  signal?: AbortSignal
}

const PROMPT_MODE_INSTRUCTIONS = `# How to Use Tools (Prompt Mode)

Your deployment does not expose the function-calling API. Emit tool calls as XML blocks inside your reply. Use exactly this format:

<shell>
the exact shell command to run
</shell>

Rules:
- Everything between the tags is passed verbatim to the sandbox shell. No escaping is needed — use single or double quotes freely.
- Emit at most ONE <shell> block per turn. Wait for the tool result before deciding your next action.
- After you receive the tool result, either emit another <shell> block or write the final user-facing answer in natural language (no <shell> tag).
- CLI arguments (flags, subcommands, positional args) MUST come from the skill's SKILL.md and its Python code. Do NOT invent flags that aren't documented there — if the skill doesn't accept a flag, use \`python -c '...'\` instead to import and call the function directly.

Format examples (argument names are placeholders — always defer to SKILL.md):

<shell>
python main.py <args-per-SKILL.md>
</shell>

<shell>
python -c "from main import some_function; print(some_function('arg'))"
</shell>

<shell>
python -c "
import json
from main import analyze
print(json.dumps(analyze('data'), indent=2))
"
</shell>`

const FUNCTION_CALL_INSTRUCTIONS = `# How to Use Tools (Function Calling)

Call the \`shell\` tool via the function-calling API. Pass the command as the \`command\` argument. All skill .py files are pre-loaded in the filesystem.

## Running scripts (argparse / if __name__ == '__main__')
shell(command="python main.py --city Tokyo --unit celsius")

## Running inline Python (quick debugging / function calls)
shell(command="python -c \\"from main import get_weather; print(get_weather('Tokyo'))\\"")

## Multi-line inline Python
shell(command="python -c \\"import json; from main import analyze; result = analyze('data'); print(json.dumps(result, indent=2))\\"")`

function buildSystemPrompt(skills: Skill[], toolMode: ToolMode): string {
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

  const toolInstructions = toolMode === 'prompt' ? PROMPT_MODE_INSTRUCTIONS : FUNCTION_CALL_INSTRUCTIONS

  return `You are a helpful assistant with access to custom Python tools.

# Available Skills

${skillSections}

${toolInstructions}

Analyze each skill's description and Python code carefully to understand what modules and functions are available.`
}

function toOpenAIMessages(messages: ChatMessage[], toolMode: ToolMode): OpenAI.Chat.ChatCompletionMessageParam[] {
  return messages
    .filter(m => m.role !== 'system')
    .map(m => {
      if (m.role === 'tool') {
        if (toolMode === 'prompt') {
          // Prompt-mode tool results are injected as user messages to keep history OpenAI-compatible
          return {
            role: 'user' as const,
            content: `Tool execution result:\n${m.content}\n\nDecide the next step based on this result.`
          }
        }
        return {
          role: 'tool' as const,
          content: m.content,
          tool_call_id: m.toolCallId || ''
        }
      }
      if (m.role === 'assistant' && m.toolCalls?.length && toolMode === 'function_call') {
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
 * Parser for prompt-mode tool calls. Matches <shell>...</shell> blocks.
 * Content is passed verbatim — no escape processing, no quote juggling.
 * Returns null if no <shell> block is found — caller treats that as the final turn.
 */
function parseShellCall(text: string): string | null {
  const match = text.match(/<shell>\s*([\s\S]*?)\s*<\/shell>/i)
  return match ? match[1].trim() : null
}

function generateId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Flatten an MCP CallToolResult's content array into a single string suitable
 * for feeding back to the LLM as a tool result.
 */
function flattenMCPContent(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content
    .map((c: unknown) => {
      if (c && typeof c === 'object' && 'type' in c) {
        const part = c as { type: string; text?: string }
        if (part.type === 'text' && typeof part.text === 'string') return part.text
      }
      return ''
    })
    .join('\n')
    .trim()
}

export async function runAgentLoop(options: AgentLoopOptions) {
  const {
    client, modelId, toolMode, skills,
    messages, mcpClient,
    onAssistantChunk, onToolCall, onToolResult, onConsole, onDone,
    signal
  } = options

  const systemPrompt = buildSystemPrompt(skills, toolMode)
  const conversationMessages = toOpenAIMessages(messages, toolMode)

  // Discover tools via MCP — the agent loop no longer hardcodes them.
  const { tools: mcpTools } = await mcpClient.listTools()
  const toolDefs: OpenAI.Chat.ChatCompletionTool[] = mcpTools.map(t => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description ?? '',
      parameters: (t.inputSchema ?? { type: 'object', properties: {} }) as Record<string, unknown>,
    },
  }))

  let iterationCount = 0
  const maxIterations = 10

  while (iterationCount < maxIterations) {
    iterationCount++

    if (signal?.aborted) {
      onConsole({ type: 'info', message: 'Agent loop aborted', timestamp: Date.now() })
      return
    }

    const requestParams: OpenAI.Chat.ChatCompletionCreateParamsStreaming = {
      model: modelId,
      messages: [
        { role: 'system', content: systemPrompt },
        ...conversationMessages
      ],
      stream: true
    }
    if (toolMode === 'function_call') {
      requestParams.tools = toolDefs
    }

    const stream = await client.chat.completions.create(requestParams)

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

      if (toolMode === 'function_call' && delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const existing = toolCalls.get(tc.index) || { id: '', name: '', arguments: '' }
          if (tc.id) existing.id = tc.id
          if (tc.function?.name) existing.name = tc.function.name
          if (tc.function?.arguments) existing.arguments += tc.function.arguments
          toolCalls.set(tc.index, existing)
        }
      }
    }

    // ---- Prompt mode branch ----
    if (toolMode === 'prompt') {
      const parsed = parseShellCall(assistantContent)
      if (!parsed) {
        // No tool call in the reply — treat it as the final answer.
        onDone({
          id: generateId(),
          role: 'assistant',
          content: assistantContent,
          timestamp: Date.now()
        })
        return
      }

      onToolCall('shell', parsed)
      onConsole({ type: 'tool', message: `Calling: ${parsed}`, timestamp: Date.now() })

      const mcpResult = await mcpClient.callTool({
        name: 'shell',
        arguments: { command: parsed },
      })
      const resultContent = flattenMCPContent((mcpResult as { content: unknown }).content) || '(no output)'

      onToolResult('shell', resultContent)

      const assistantMsg: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        content: assistantContent,
        timestamp: Date.now()
      }
      messages.push(assistantMsg)
      conversationMessages.push({ role: 'assistant', content: assistantContent })

      const toolMsg: ChatMessage = {
        id: generateId(),
        role: 'tool',
        content: resultContent,
        timestamp: Date.now()
      }
      messages.push(toolMsg)
      conversationMessages.push({
        role: 'user',
        content: `Tool execution result:\n${resultContent}\n\nDecide the next step based on this result.`
      })

      continue
    }

    // ---- Function-call mode branch ----
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
    messages.push(assistantMsg)

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
      let parsedArgs: Record<string, unknown> = {}
      try {
        parsedArgs = tc.arguments ? JSON.parse(tc.arguments) : {}
      } catch {
        parsedArgs = {}
      }

      // Use whatever the LLM sent as the display string — falls back to the
      // raw arg blob so ill-formed JSON still shows up in the console.
      const displayArg = typeof parsedArgs.command === 'string'
        ? (parsedArgs.command as string)
        : (tc.arguments || '')

      onToolCall(tc.name, displayArg)
      onConsole({ type: 'tool', message: `Calling: ${tc.name}(${displayArg})`, timestamp: Date.now() })

      const mcpResult = await mcpClient.callTool({
        name: tc.name,
        arguments: parsedArgs,
      })
      const resultContent = flattenMCPContent((mcpResult as { content: unknown }).content) || '(no output)'

      onToolResult(tc.name, resultContent)

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
