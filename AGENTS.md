# Agent Sandbox Playground

## Overview
Browser-based playground for debugging custom OpenAI-format skills. Users author skills (SKILL.md + Python + data files) in the editor and test them interactively through an LLM chat.

## Tech Stack
- **Frontend**: Vite + React 18 (TypeScript) + GitHub Pages
- **Python Sandbox**: Pyodide (WASM) in Web Worker
- **Agent ↔ tools**: `@modelcontextprotocol/sdk` — two MCP servers live in the browser tab and talk to the agent via `InMemoryTransport`
- **LLM Client**: OpenAI JS SDK (browser-side, `dangerouslyAllowBrowser: true`)
- **Code Editor**: CodeMirror 6
- **Node**: v25.8.0 via Homebrew (`/opt/homebrew/bin/node`)

## Architecture

Two independent MCP servers run in the same page, mirroring a real agent container's dependencies:

- **FS MCP** (`src/mcp/fs-server.ts`) — read-only filesystem backed by the editor's skill state. Tools: `list_files`, `read_file`. Exposes each skill as a top-level directory. Completely generic — no "skill" vocabulary leaks into the MCP surface.
- **Sandbox MCP** (`src/mcp/sandbox-server.ts`) — read-write ephemeral Pyodide workspace at `/workspace` (empty at init). Tools: `shell`, `list_files`, `read_file`, `write_file`. Also generic.

The agent loop (`src/agent/loop.ts`) takes an array of named MCP clients, discovers their tools via `listTools()`, namespaces them with prefixes (`fs__*`, `sandbox__*`), and dispatches calls via `callTool()`. Prompt-mode instructions are rendered dynamically from the tool list. Each server's `instructions` field is automatically folded into the system prompt.

The "business-layer" system prompt (in `src/components/Playground.tsx`) is what maps user domain vocabulary like "skill" onto the generic MCP tools. That split — generic MCPs, business-side semantic glue — is the intended production model.

## Project Structure
- `index.html` — Vite entry
- `src/main.tsx` + `src/App.tsx` — React mount + app shell
- `src/components/` — React components (one `.tsx` + one `.css` per component)
- `src/agent/` — OpenAI client and agent loop
- `src/sandbox/` — Pyodide Web Worker and manager
- `src/mcp/` — In-browser MCP servers (sandbox + read-only fs)
- `src/hooks/` — React hooks (theme context)
- `src/styles/cosmic.css` — global theme tokens
- `examples/` — example skill zips

## Commands
- `npm run dev` — Start Vite dev server
- `npm run build` — Build static site (output: `dist/`)
- `npm run preview` — Preview production build
- `npm run serve` — Serve built `dist/` + proxy `/api/*` to `API_TARGET`

## Deployment
- GitHub Actions on push to main → build → deploy to GitHub Pages
- Pages base path: `/agent-sandbox-playground/` (set in `vite.config.ts`)
