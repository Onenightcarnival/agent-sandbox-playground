# Agent Sandbox Playground

Browser-based playground for debugging custom OpenAI-format skills. Upload skill `.zip` packages and test them interactively via chat with any OpenAI-compatible LLM.

## Features

- **Two in-browser MCP servers** — a read-only `fs` MCP backed by the editor (the "skill library") plus a generic `sandbox` MCP backed by Pyodide (the execution environment). The LLM sees two namespaced tool surfaces (`fs__*`, `sandbox__*`) and drives the full list → read → copy → execute flow itself.
- **Pyodide sandbox** — Python code runs in-browser via WebAssembly, no backend required. `/workspace` starts empty; files are staged via MCP `write_file` calls.
- **Multi-skill support** — upload multiple skill zips, all visible in the fs MCP simultaneously.
- **Mixed-content skills** — SKILL.md, `.py`, `.json`, `.yaml/.yml`, `.toml`, `.ini`, `.md`, `.txt`, `.csv`, etc. are all loaded and exposed.
- **Live editor** — CodeMirror-based editing; changes flow into the fs MCP immediately.
- **Streaming chat + collapsible tool results** — long tool outputs (e.g. `read_file`) auto-collapse to a one-line summary, click to expand.
- **Console panel** — real-time log of sandbox stdout/stderr, MCP tool calls, and agent loop events.

## Skill Zip Format

```
my-skill/
├── SKILL.md             # Required: YAML frontmatter (name, description) + human instructions
├── main.py              # Python implementation
├── utils.py             # Additional modules (importable)
├── calibration.json     # Arbitrary data files are also allowed
└── requirements.txt     # Optional: pip dependencies (installed via micropip at load time)
```

Any text-like file is loaded; binary files and `__pycache__/` are ignored.

## Quick Start

1. Install + run:

   ```bash
   npm install
   npm run dev
   ```

2. Open the playground, click **Edit ▾** in the top bar, and fill in Base URL / API Key / Model. These are cached in `localStorage`.

3. Upload a skill zip (there's an example in `examples/unit-converter.zip`). Ask the LLM something like `通过 unit-converter 告诉我 100 华氏度是多少摄氏度` and watch it drive the FS + sandbox MCPs.

### Optional: pre-populate LLM config from `.env.local`

For local dev, you can skip the config panel typing:

```
# .env.local (gitignored)
VITE_OPENAI_BASE_URL=https://openrouter.ai/api/v1
VITE_OPENAI_API_KEY=sk-...
VITE_OPENAI_MODEL_ID=openai/gpt-5-nano
```

These values are used only when nothing is saved in `localStorage`.

### Internal network deployment

If your LLM gateway blocks browser CORS, use the built-in proxy:

```bash
cp .env.example .env
# edit .env: API_TARGET=https://your-llm-gateway
npm run build
npm run serve
```

Then set the UI Base URL to `/api/v1` — the node server serves the static bundle and proxies `/api/*` to `API_TARGET`.

## Architecture

```
┌────────────────── Playground (React) ─ business container ──────┐
│  Editor state (skills) ─────► System prompt (domain vocabulary) │
│          │                         │                            │
│          ▼                         ▼                            │
│       fs MCP          sandbox MCP          Agent loop           │
│   (read-only)      (Pyodide workspace)         │                │
│    list_files         shell / list_files       │                │
│    read_file          read_file / write_file   │                │
│          ▲                         ▲           │                │
│          └─────────────────────────┴───────────┘                │
│                     InMemoryTransport                           │
└─────────────────────────────────────────────────────────────────┘
```

Both MCP servers run in-page using `@modelcontextprotocol/sdk` with `InMemoryTransport`. The agent loop is MCP-protocol-native: it calls `listTools()` on each client, namespaces the tools, and dispatches via `callTool()`.

Because the MCP surface is generic, any domain vocabulary ("skill") is glued on at the business layer via a user-editable prompt template — not baked into the tools. This mirrors how a real agent deployment separates concerns between a generic sandbox MCP service and the business code that wires it up.

## Tech Stack

- Vite + React 18 (TypeScript)
- Pyodide in a Web Worker for in-browser Python
- `@modelcontextprotocol/sdk` for the MCP server/client pair (browser-safe subpath imports, no stdio)
- CodeMirror 6 for code editing
- OpenAI JS SDK (browser mode)

## Deployment

- **GitHub Pages**: auto-deployed via GitHub Actions on push to `main` (for external demo / public APIs with CORS support)
- **Internal network**: `npm run serve` for static files + API proxy on a single port
