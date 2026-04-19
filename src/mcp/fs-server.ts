import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import type { Skill } from '@/types'

export interface FSMCPOptions {
  /** Returns the current editor-side skill corpus. Called on every tool invocation
   *  so edits surface immediately without rebuilding the server. */
  getSkills: () => Skill[]
}

/**
 * Generic read-only filesystem MCP. No knowledge of "skills" leaks into the
 * MCP surface — tool descriptions and server instructions describe a plain
 * read-only FS. The business layer happens to back it with editor state, and
 * that state happens to be organized as top-level directories per skill, but
 * that structure is implicit in the path tree — not declared in the interface.
 */
export async function createFSMCP(opts: FSMCPOptions): Promise<Client> {
  const server = new Server(
    { name: 'read-only-fs', version: '0.1.0' },
    {
      capabilities: { tools: {} },
      instructions:
        'Read-only filesystem. Provides list_files and read_file over a shared content tree. ' +
        'No write access — use a separate sandbox (with write_file) if you need to execute or modify anything.',
    },
  )

  /** Flatten a Skill into its visible files. Mirrors what the editor stores. */
  function collectFiles(skill: Skill): Array<{ path: string; content: string }> {
    const out: Array<{ path: string; content: string }> = [
      { path: `${skill.name}/SKILL.md`, content: skill.skillMd },
    ]
    if (skill.requirements) {
      out.push({ path: `${skill.name}/requirements.txt`, content: skill.requirements })
    }
    for (const f of skill.files) {
      out.push({ path: `${skill.name}/${f.name}`, content: f.content })
    }
    return out
  }

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'list_files',
        description:
          'List all files in the read-only filesystem. With "prefix", returns only paths under that prefix.',
        inputSchema: {
          type: 'object',
          properties: {
            prefix: { type: 'string', description: 'Optional path prefix filter.' },
          },
        },
      },
      {
        name: 'read_file',
        description: 'Read the full contents of a file from the read-only filesystem.',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path to the file, as returned by list_files.' },
          },
          required: ['path'],
        },
      },
    ],
  }))

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: rawArgs } = req.params
    const args = (rawArgs ?? {}) as Record<string, unknown>
    const skills = opts.getSkills()
    const allFiles = skills.flatMap(collectFiles)

    if (name === 'list_files') {
      const prefix = typeof args.prefix === 'string' ? args.prefix : ''
      const matches = allFiles
        .filter(f => !prefix || f.path.startsWith(prefix))
        .map(f => f.path)
        .sort()
      const text = matches.length > 0 ? matches.join('\n') : '(no files)'
      return { content: [{ type: 'text', text }] }
    }

    if (name === 'read_file') {
      const path = typeof args.path === 'string' ? args.path : ''
      if (!path) return { content: [{ type: 'text', text: 'Error: missing "path"' }], isError: true }
      const hit = allFiles.find(f => f.path === path)
      if (!hit) {
        return { content: [{ type: 'text', text: `Error: no such file: ${path}` }], isError: true }
      }
      return { content: [{ type: 'text', text: hit.content }] }
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
