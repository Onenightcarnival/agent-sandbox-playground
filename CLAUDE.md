# Agent Sandbox Playground

## Overview
Browser-based playground for debugging custom OpenAI-format skills. Users write Python code + SKILL.md, test via chat with LLM.

## Tech Stack
- **Frontend**: VitePress (Vue 3) + GitHub Pages
- **Python Sandbox**: Pyodide (WASM) in Web Worker
- **LLM Client**: OpenAI JS SDK (browser-side, `dangerouslyAllowBrowser: true`)
- **Code Editor**: CodeMirror 6
- **Node**: v25.8.0 via Homebrew (`/opt/homebrew/bin/node`)

## Architecture
- JS handles the agent loop (OpenAI API calls + tool_call routing)
- Pyodide sandbox executes user Python code only
- SKILL.md content injected into system prompt for LLM to understand available tools
- No prescribed Python code format — LLM interprets SKILL.md to decide how to call functions
- Common Python packages (requests, httpx) available via micropip

## Project Structure
- `docs/` — VitePress content and config
- `src/components/` — Vue components
- `src/agent/` — OpenAI client and agent loop
- `src/sandbox/` — Pyodide Web Worker and manager

## Commands
- `npm run dev` — Start VitePress dev server
- `npm run build` — Build static site
- `npm run preview` — Preview production build

## Deployment
- GitHub Actions on push to main → build → deploy to GitHub Pages
