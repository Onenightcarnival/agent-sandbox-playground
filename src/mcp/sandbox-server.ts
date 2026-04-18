import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import type { PyodideSandbox } from '@/sandbox/sandbox'
import type { SkillFile } from '@/types'

export interface CodeFile { name: string; content: string }

export interface InBrowserMCPOptions {
  sandbox: PyodideSandbox
  getCodeFiles: () => CodeFile[]
  getEnvVars: () => Record<string, string>
}

/**
 * Spins up an MCP server + client pair entirely in the current browser context.
 * The server wraps the Pyodide sandbox as MCP tools; the client is returned for
 * the agent loop to discover/dispatch tools through the standard MCP protocol.
 */
export async function createInBrowserMCP(opts: InBrowserMCPOptions): Promise<Client> {
  const server = new Server(
    { name: 'pyodide-sandbox', version: '0.1.0' },
    { capabilities: { tools: {} } }
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'shell',
        description:
          'Run a shell command in the Python sandbox. Use "python script.py args" to run scripts, or "python -c \'code\'" for inline Python. All skill files are pre-loaded in the working directory.',
        inputSchema: {
          type: 'object',
          properties: {
            command: {
              type: 'string',
              description:
                'The shell command to execute, e.g. "python main.py --city Tokyo" or "python -c \\"from main import func; print(func())\\"".',
            },
          },
          required: ['command'],
        },
      },
      {
        name: 'list_files',
        description:
          'List files and directories in the current skill working directory. Use this to explore what the sandbox sees before invoking shell.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
    ],
  }))

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params
    const codeFiles = opts.getCodeFiles()
    const envVars = opts.getEnvVars()

    if (name === 'shell') {
      const command = typeof (args as Record<string, unknown>)?.command === 'string'
        ? ((args as Record<string, unknown>).command as string)
        : ''
      if (!command) {
        return {
          content: [{ type: 'text', text: 'Error: missing "command" argument' }],
          isError: true,
        }
      }
      const result = await opts.sandbox.execute(codeFiles, command, envVars)
      return {
        content: [{
          type: 'text',
          text: result.success ? (result.output || '(no output)') : `Error: ${result.error}`,
        }],
        isError: !result.success,
      }
    }

    if (name === 'list_files') {
      const result = await opts.sandbox.execute(
        codeFiles,
        `python -c "import os; print('\\n'.join(sorted(os.listdir())))"`,
        envVars,
      )
      return {
        content: [{
          type: 'text',
          text: result.success ? (result.output || '(empty)') : `Error: ${result.error}`,
        }],
        isError: !result.success,
      }
    }

    return {
      content: [{ type: 'text', text: `Unknown tool: ${name}` }],
      isError: true,
    }
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

export type { SkillFile }
