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

```bash
npm install
npm run dev
```

Open `http://localhost:5173/agent-sandbox-playground/playground` and:

1. Fill in Base URL, API Key, and Model
2. Upload a skill `.zip` file (see `examples/test-skill.zip`)
3. Chat to test your skill

## Deployment

Automatically deployed to GitHub Pages via GitHub Actions on push to `main`.
