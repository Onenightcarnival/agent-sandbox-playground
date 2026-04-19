import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import type { PyodideSandbox } from '@/sandbox/sandbox'

export interface SandboxMCPOptions {
  sandbox: PyodideSandbox
  getEnvVars: () => Record<string, string>
}

/**
 * A *generic* sandbox MCP server. Mirrors what a real container-backed sandbox
 * (e.g. agent-infra) would expose: raw file IO plus shell execution. It knows
 * nothing about "skills" — the business layer (or the agent itself) is
 * responsible for populating /workspace.
 */
export async function createSandboxMCP(opts: SandboxMCPOptions): Promise<Client> {
  const server = new Server(
    { name: 'sandbox', version: '0.1.0' },
    {
      capabilities: { tools: {} },
      instructions:
        'Ephemeral execution sandbox. Working directory is /workspace; it starts empty. ' +
        'Use write_file to stage source files, then shell to run them (e.g. `python main.py`). ' +
        'Files in /workspace are importable as Python modules.',
    },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'shell',
        description:
          'Execute a shell-like command in the sandbox. Supports: `python script.py [args...]`, `python -c "<inline code>"`, or a raw Python expression. Working directory is /workspace.',
        inputSchema: {
          type: 'object',
          properties: {
            command: {
              type: 'string',
              description: 'Command to run, e.g. "python main.py --city Tokyo".',
            },
          },
          required: ['command'],
        },
      },
      {
        name: 'list_files',
        description: 'List entries in a sandbox directory. Defaults to /workspace. Returns name + type (file|dir) for each entry.',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Absolute path or path relative to /workspace. Defaults to /workspace.' },
          },
        },
      },
      {
        name: 'read_file',
        description: 'Read a text file from the sandbox. Paths are absolute or relative to /workspace.',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path, e.g. "main.py" or "/workspace/pkg/mod.py".' },
          },
          required: ['path'],
        },
      },
      {
        name: 'write_file',
        description: 'Write a text file to the sandbox, creating parent directories as needed. Overwrites if it exists.',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Destination path, e.g. "main.py" or "/workspace/pkg/mod.py".' },
            content: { type: 'string', description: 'File contents.' },
          },
          required: ['path', 'content'],
        },
      },
    ],
  }))

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: rawArgs } = req.params
    const args = (rawArgs ?? {}) as Record<string, unknown>

    if (name === 'shell') {
      const command = typeof args.command === 'string' ? args.command : ''
      if (!command) {
        return { content: [{ type: 'text', text: 'Error: missing "command"' }], isError: true }
      }
      const result = await opts.sandbox.execute(command, opts.getEnvVars())
      return {
        content: [{ type: 'text', text: result.success ? (result.output || '(no output)') : `Error: ${result.error}` }],
        isError: !result.success,
      }
    }

    if (name === 'list_files') {
      const path = typeof args.path === 'string' ? args.path : undefined
      const result = await opts.sandbox.listDir(path)
      if (!result.success) {
        return { content: [{ type: 'text', text: `Error: ${result.error}` }], isError: true }
      }
      const formatted = (result.entries ?? [])
        .map(e => `${e.type === 'dir' ? 'd' : 'f'}  ${e.name}`)
        .join('\n') || '(empty directory)'
      return {
        content: [{ type: 'text', text: `${result.path}\n${formatted}` }],
      }
    }

    if (name === 'read_file') {
      const path = typeof args.path === 'string' ? args.path : ''
      if (!path) return { content: [{ type: 'text', text: 'Error: missing "path"' }], isError: true }
      const result = await opts.sandbox.readFile(path)
      if (!result.success) {
        return { content: [{ type: 'text', text: `Error: ${result.error}` }], isError: true }
      }
      return { content: [{ type: 'text', text: result.content ?? '' }] }
    }

    if (name === 'write_file') {
      const path = typeof args.path === 'string' ? args.path : ''
      const content = typeof args.content === 'string' ? args.content : ''
      if (!path) return { content: [{ type: 'text', text: 'Error: missing "path"' }], isError: true }
      const result = await opts.sandbox.writeFile(path, content)
      if (!result.success) {
        return { content: [{ type: 'text', text: `Error: ${result.error}` }], isError: true }
      }
      return { content: [{ type: 'text', text: `Wrote ${result.path} (${content.length} bytes)` }] }
    }

    return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true }
  })

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)

  const client = new Client(
    { name: 'agent-loop', version: '0.1.0' },
    { capabilities: {} },
  )
  await client.connect(clientTransport)

  return client
}
