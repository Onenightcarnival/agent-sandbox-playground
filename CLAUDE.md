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

Two independent MCP servers live in the same browser tab, paired to the agent loop through `InMemoryTransport` from `@modelcontextprotocol/sdk`.

- **FS MCP** (`src/mcp/fs-server.ts`) — read-only filesystem backed by the editor's skill state. Tools: `list_files`, `read_file`. Each skill sits under its own top-level directory.
- **Sandbox MCP** (`src/mcp/sandbox-server.ts`) — read-write ephemeral Pyodide workspace at `/workspace` (empty at init). Tools: `shell`, `list_files`, `read_file`, `write_file`.

The agent loop (`src/agent/loop.ts`) takes an array of named MCP clients, discovers tools via `listTools()`, namespaces them with per-server prefixes (`fs__*`, `sandbox__*`), and dispatches via `callTool()`. Each server's `instructions` string is folded into the system prompt automatically; prompt-mode tool docs are rendered dynamically from the live tool list.

Common Python packages (requests, httpx) are available via micropip; `pyodide_http.patch_all()` is pre-applied so `requests`/`httpx` work in the browser.

### Responsibility split

- **Sandbox MCP** — ephemeral execution environment. Knows nothing about "skills". Production analog: a Docker container or a remote sandbox service.
- **FS MCP** — read-only content store. Knows nothing about "skills". Production analog: an S3 bucket / git repo / skill registry.
- **Playground (React app)** — the "business container". Owns editor state, translates domain vocabulary (the word "skill") into concrete MCP tool sequences via a `systemPromptExtra` fragment, and orchestrates the agent loop.

### Design principles

- MCP servers stay **generic**: no domain vocabulary ("skill") appears in tool names, tool descriptions, or server instructions. Either server could be swapped for a real remote implementation without the agent loop noticing.
- **No implicit preloading.** `/workspace` starts empty; the agent stages files itself through `sandbox.write_file`. This mirrors what a real deployment has to do at boot.
- **Discovery over hardcoding.** Tools are fetched via `listTools()`; adding a third MCP means a file drop-in, not a loop change. Prompt-mode docs are generated from live schemas.
- **Self-description propagates.** Each server's MCP `instructions` field is surfaced to the LLM automatically, so new servers become visible without prompt-engineering in the loop.
- **Domain semantics live only in the business layer.** Mapping "the X skill" → `fs.list_files` → `sandbox.write_file` → `sandbox.shell` is a `systemPromptExtra` string owned by the Playground, not any tool description.

## Project Structure
- `index.html` — Vite entry
- `src/main.tsx` + `src/App.tsx` — React mount + app shell
- `src/components/` — React components (one `.tsx` + one `.css` per component)
- `src/agent/` — OpenAI client and agent loop
- `src/sandbox/` — Pyodide Web Worker + manager
- `src/mcp/` — In-browser MCP servers (sandbox + read-only fs)
- `src/hooks/` — React hooks
- `src/styles/cosmic.css` — global theme tokens
- `examples/` — example skill zips (e.g. `unit-converter.zip`)

## Commands
- `npm run dev` — Start Vite dev server
- `npm run build` — Build static site (output: `dist/`)
- `npm run preview` — Preview production build
- `npm run serve` — Serve built `dist/` + proxy `/api/*` to `API_TARGET`

## Local dev config
`.env.local` (gitignored) can pre-populate the Config panel:
```
VITE_OPENAI_BASE_URL=...
VITE_OPENAI_API_KEY=...
VITE_OPENAI_MODEL_ID=...
```
These are only used when nothing is saved in localStorage yet.

## Deployment
- GitHub Actions on push to main → build → deploy to GitHub Pages
- Pages base path: `/agent-sandbox-playground/` (set in `vite.config.ts`)
