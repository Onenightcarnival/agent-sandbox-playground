import type OpenAI from 'openai'
import type { Client as MCPClient } from '@modelcontextprotocol/sdk/client/index.js'
import type { ChatMessage, ConsoleEntry, ToolMode } from '@/types'

export interface NamedMCPClient {
  /** Short prefix used for tool-name namespacing (e.g. 'fs', 'sandbox'). */
  prefix: string
  client: MCPClient
}

interface AgentLoopOptions {
  client: OpenAI
  modelId: string
  toolMode: ToolMode
  messages: ChatMessage[]
  mcpClients: NamedMCPClient[]
  /** Extra text appended to the (otherwise minimal) system prompt. */
  systemPromptExtra?: string
  onAssistantChunk: (chunk: string) => void
  onToolCall: (name: string, args: string) => void
  onToolResult: (name: string, result: string) => void
  onConsole: (entry: ConsoleEntry) => void
  onDone: (message: ChatMessage) => void
  signal?: AbortSignal
}

const TOOL_SEPARATOR = '__'

/** Render a JSON Schema into a compact one-line arg hint for prompt-mode docs. */
function renderArgHint(schema: unknown): string {
  if (!schema || typeof schema !== 'object') return '{}'
  const s = schema as { properties?: Record<string, { type?: string; description?: string }>; required?: string[] }
  const props = s.properties ?? {}
  const required = new Set(s.required ?? [])
  const fields = Object.entries(props).map(([name, def]) => {
    const optional = required.has(name) ? '' : '?'
    const type = def?.type ?? 'any'
    return `${name}${optional}: ${type}`
  })
  return `{${fields.join(', ')}}`
}

/**
 * Build prompt-mode tool-use docs from the actual tool list, so it scales
 * automatically as MCP servers / tools come and go. The XML vocabulary:
 *   <tool_call name="NAME">
 *   {"arg": "value"}
 *   </tool_call>
 */
function buildPromptModeInstructions(toolDefs: OpenAI.Chat.ChatCompletionTool[]): string {
  if (toolDefs.length === 0) return ''

  const toolLines = toolDefs
    .filter((t): t is Extract<OpenAI.Chat.ChatCompletionTool, { type: 'function' }> => t.type === 'function')
    .map(t => {
      const name = t.function.name
      const desc = (t.function.description ?? '').trim().split('\n')[0]
      const argHint = renderArgHint(t.function.parameters)
      return `- ${name} ${argHint} — ${desc}`
    })
    .join('\n')

  return `# How to Use Tools (Prompt Mode)

Your deployment does not expose the function-calling API. Emit each tool call as an XML block with JSON arguments:

<tool_call name="TOOL_NAME">
{"arg1": "value1", "arg2": "value2"}
</tool_call>

Available tools:

${toolLines}

Rules:
- Emit at most ONE <tool_call> block per turn. Wait for the result before deciding your next action.
- JSON inside the block must be valid — keys in double quotes, no trailing commas.
- After the tool result arrives, either emit another <tool_call> or give the final natural-language answer (no <tool_call>).
- Tool names are namespaced as "<server>__<tool>" (e.g. "sandbox__shell", "fs__read_file").`
}

function namespacedName(prefix: string, name: string): string {
  return `${prefix}${TOOL_SEPARATOR}${name}`
}

function routeTool(clients: NamedMCPClient[], qualified: string): { client: MCPClient; bareName: string } | null {
  const sep = qualified.indexOf(TOOL_SEPARATOR)
  if (sep < 0) return null
  const prefix = qualified.slice(0, sep)
  const bareName = qualified.slice(sep + TOOL_SEPARATOR.length)
  const hit = clients.find(c => c.prefix === prefix)
  return hit ? { client: hit.client, bareName } : null
}

function buildSystemPrompt(
  extra: string | undefined,
  toolMode: ToolMode,
  toolDefs: OpenAI.Chat.ChatCompletionTool[],
): string {
  const base = 'You are a helpful assistant.'
  const parts = [base]
  if (extra) parts.push(extra)
  if (toolMode === 'prompt') {
    const instr = buildPromptModeInstructions(toolDefs)
    if (instr) parts.push(instr)
  }
  return parts.join('\n\n')
}

function toOpenAIMessages(messages: ChatMessage[], toolMode: ToolMode): OpenAI.Chat.ChatCompletionMessageParam[] {
  return messages
    .filter(m => m.role !== 'system')
    .map(m => {
      if (m.role === 'tool') {
        if (toolMode === 'prompt') {
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
 * Parse a <tool_call name="NAME">JSON</tool_call> block from the model's reply.
 * Returns null if no block (caller treats that as the final answer).
 * Returns { name, args, parseError } when a block is present; parseError is
 * populated if the JSON is malformed so we can feed that back to the model.
 */
function parseToolCall(text: string): { name: string; args: Record<string, unknown>; parseError?: string } | null {
  const match = text.match(/<tool_call\s+name=["']([^"']+)["']\s*>([\s\S]*?)<\/tool_call>/i)
  if (!match) return null
  const name = match[1].trim()
  const body = match[2].trim()
  if (!body) return { name, args: {} }
  try {
    const parsed = JSON.parse(body)
    return { name, args: (parsed && typeof parsed === 'object') ? parsed : {} }
  } catch (e: any) {
    return { name, args: {}, parseError: `Invalid JSON in <tool_call>: ${e.message}` }
  }
}

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

function generateId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

export async function runAgentLoop(options: AgentLoopOptions) {
  const {
    client, modelId, toolMode,
    messages, mcpClients, systemPromptExtra,
    onAssistantChunk, onToolCall, onToolResult, onConsole, onDone,
    signal
  } = options

  const conversationMessages = toOpenAIMessages(messages, toolMode)

  // Discover tools across every MCP client, namespacing by prefix, and collect
  // each server's self-advertised instructions so the LLM knows what each MCP
  // is for without the agent loop having to hardcode that knowledge.
  const toolDefs: OpenAI.Chat.ChatCompletionTool[] = []
  const serverHints: string[] = []
  for (const { prefix, client: mcp } of mcpClients) {
    const { tools } = await mcp.listTools()
    for (const t of tools) {
      toolDefs.push({
        type: 'function',
        function: {
          name: namespacedName(prefix, t.name),
          description: t.description ?? '',
          parameters: (t.inputSchema ?? { type: 'object', properties: {} }) as Record<string, unknown>,
        },
      })
    }
    const info = mcp.getServerVersion?.()
    const instructions = mcp.getInstructions?.()
    if (instructions) {
      const label = info?.name ? `${prefix} (${info.name})` : prefix
      serverHints.push(`## MCP server "${label}"\n${instructions}`)
    }
  }

  // Prompt-mode instructions are derived from toolDefs — scales with whatever
  // servers are connected, no hardcoding.
  const serverBlock = serverHints.length > 0
    ? `# Connected MCP servers\n\n${serverHints.join('\n\n')}`
    : ''
  const fullExtra = [systemPromptExtra, serverBlock].filter(Boolean).join('\n\n') || undefined
  const systemPrompt = buildSystemPrompt(fullExtra, toolMode, toolDefs)

  let iterationCount = 0
  const maxIterations = 20 // Mode B needs more steps: list → read → write → shell

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

    // ---- Prompt mode branch (generic <tool_call>) ----
    if (toolMode === 'prompt') {
      const parsed = parseToolCall(assistantContent)
      if (!parsed) {
        onDone({
          id: generateId(),
          role: 'assistant',
          content: assistantContent,
          timestamp: Date.now()
        })
        return
      }

      const displayArg = JSON.stringify(parsed.args).slice(0, 200)
      onToolCall(parsed.name, displayArg)
      onConsole({ type: 'tool', message: `Calling: ${parsed.name}(${displayArg})`, timestamp: Date.now() })

      let resultContent: string
      if (parsed.parseError) {
        resultContent = `Error: ${parsed.parseError}`
      } else {
        const route = routeTool(mcpClients, parsed.name)
        if (!route) {
          resultContent = `Error: unknown tool "${parsed.name}" (no matching MCP client)`
        } else {
          const mcpResult = await route.client.callTool({ name: route.bareName, arguments: parsed.args })
          resultContent = flattenMCPContent((mcpResult as { content: unknown }).content) || '(no output)'
        }
      }

      onToolResult(parsed.name, resultContent)

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

      const displayArg = Object.keys(parsedArgs).length > 0
        ? JSON.stringify(parsedArgs).slice(0, 200)
        : (tc.arguments || '')

      onToolCall(tc.name, displayArg)
      onConsole({ type: 'tool', message: `Calling: ${tc.name}(${displayArg})`, timestamp: Date.now() })

      const route = routeTool(mcpClients, tc.name)
      let resultContent: string
      if (!route) {
        resultContent = `Error: unknown tool "${tc.name}" (no matching MCP client)`
      } else {
        const mcpResult = await route.client.callTool({ name: route.bareName, arguments: parsedArgs })
        resultContent = flattenMCPContent((mcpResult as { content: unknown }).content) || '(no output)'
      }

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
