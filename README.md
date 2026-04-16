# Agent Sandbox Playground

Browser-based playground for debugging custom OpenAI-format skills. Upload skill `.zip` packages and test them interactively via chat with any OpenAI-compatible LLM.

## Features

- **Pyodide sandbox** -- Python code runs in-browser via WebAssembly, no backend required
- **Multi-skill support** -- upload multiple skill zips, all loaded simultaneously
- **Multi-file skills** -- each skill can contain SKILL.md + multiple `.py` files with cross-file imports
- **Live editor** -- edit SKILL.md and Python files directly in the browser
- **Streaming chat** -- agent loop with streaming responses and tool call visualization
- **Console panel** -- real-time logs for sandbox output, errors, and tool execution

## Skill Zip Format

```
my-skill/
├── SKILL.md            # Required: YAML frontmatter (name, description) + instructions
├── main.py             # Python implementation
├── utils.py            # Additional modules (importable)
└── requirements.txt    # Optional: pip dependencies
```

## Quick Start

1. Copy `.env.example` to `.env` and set your LLM API address:

```bash
cp .env.example .env
# edit .env: API_TARGET=http://your-llm-api:8000
```

2. Development:

```bash
npm install
npm run dev
```

3. Production (internal network):

```bash
npm run build
npm run serve
```

Open the playground, set Base URL to `/api/v1`, fill in API Key and Model.

The built-in proxy forwards `/api/*` to your LLM API, avoiding CORS issues. No extra dependencies needed.

## Deployment

- **GitHub Pages**: auto-deployed via GitHub Actions on push to `main` (for external demo / public APIs with CORS support)
- **Internal network**: use `npm run serve` to serve static files + API proxy on one port
